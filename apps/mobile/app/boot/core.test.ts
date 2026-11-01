import { RIDE_UPDATED_EVENT } from '@lern/contracts';
import type { io } from 'socket.io-client';
import type { KeyValueStore, SecretStore } from '../services/storage.service';
import { createCore } from './core';

const me = {
  id: '00000000-0000-4000-8000-0000000000d1',
  phone: '+85512345678',
  roles: ['rider', 'driver'],
};
const rideId = '00000000-0000-4000-8000-000000000001';
const ride = (status: string, version: number) => ({
  id: rideId,
  status,
  version,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 4000, currency: 'KHR' },
});
const pair = { accessToken: 'access-2', refreshToken: 'r'.repeat(43) };

// A server keyed by "METHOD /path"; offline = every request fails at the network
function server(
  routes: Record<string, () => { status: number; body?: unknown }>,
) {
  const calls: string[] = [];
  const state = { offline: false };
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    const route = `${init.method} ${url.replace('http://api.test', '')}`;
    calls.push(route);
    if (state.offline || !routes[route])
      throw new TypeError('Network request failed');
    const { status, body } = routes[route]();
    return {
      status,
      ok: status < 300,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  });
  return { calls, state, fetch: fetch as unknown as typeof globalThis.fetch };
}
function fakeIo() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const socket = {
    connected: false,
    on: (e: string, h: (...a: unknown[]) => unknown) => handlers.set(e, h),
    connect: jest.fn(),
    disconnect: jest.fn(),
    timeout: () => ({ emitWithAck: async () => ({ dropped: 0 }) }),
  };
  const fire = (e: string, ...a: unknown[]) => handlers.get(e)?.(...a);
  return { io: jest.fn(() => socket) as unknown as typeof io, socket, fire };
}
function deps(
  s: ReturnType<typeof server>,
  f: ReturnType<typeof fakeIo>,
  refresh?: string,
  sleep: () => Promise<void> = async () => undefined,
) {
  const m = new Map<string, string>();
  const kv: KeyValueStore = {
    get: k => m.get(k),
    set: (k, v) => {
      m.set(k, v);
    },
    remove: k => {
      m.delete(k);
    },
  };
  let secret = refresh;
  const refreshToken: SecretStore = {
    get: async () => secret,
    set: async v => {
      secret = v;
    },
    clear: async () => {
      secret = undefined;
    },
  };
  return {
    baseUrl: 'http://api.test',
    fetch: s.fetch,
    io: f.io,
    kv,
    refreshToken,
    sleep,
    secret: () => secret,
  };
}
const settle = () =>
  new Promise<void>(resolve => setImmediate(() => resolve()));
const routes = (
  extra: Record<string, () => { status: number; body?: unknown }> = {},
) => ({
  'POST /auth/refresh': () => ({ status: 200, body: pair }),
  'GET /me': () => ({ status: 200, body: me }),
  'GET /drivers/me': () => ({
    status: 200,
    body: {
      vehicleType: 'remork',
      plate: 'PP 1',
      verification: 'verified',
      availability: 'on_trip',
    },
  }),
  'GET /me/active-ride': () => ({
    status: 200,
    body: { rider: null, driver: ride('in_progress', 4), offer: null },
  }),
  ...extra,
});

it('boots from a stored refresh token: session, driver availability, then the snapshot on connect', async () => {
  const s = server(routes());
  const f = fakeIo();
  const core = createCore(deps(s, f, 'r'.repeat(43)));
  await core.boot();
  expect(core.stores.session.getState()).toMatchObject({
    status: 'signed_in',
    me,
  });
  expect(core.stores.driverMode.getState().availability).toBe('on_trip');

  f.fire('connect');
  await settle();
  expect(core.stores.activeRide.getState().driver).toEqual(
    ride('in_progress', 4),
  );
  f.fire(RIDE_UPDATED_EVENT, ride('driver_arrived', 3)); // late: older than the snapshot
  expect(core.stores.activeRide.getState().driver?.version).toBe(4);
});

it('boots signed out without a stored refresh token, and never opens a socket', async () => {
  const f = fakeIo();
  const core = createCore(deps(server(routes()), f));
  await core.boot();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(f.io).not.toHaveBeenCalled();
});

it('queues a trip step while offline and sends it once the socket is back', async () => {
  let answered = 0;
  const s = server(
    routes({
      [`POST /rides/${rideId}/complete`]: () => {
        answered++;
        return { status: 200, body: ride('completed', 5) };
      },
    }),
  );
  const f = fakeIo();
  const core = createCore(deps(s, f, 'r'.repeat(43)));
  await core.boot();
  s.state.offline = true;
  await core.step(rideId, 'complete');
  expect([answered, core.queue.pending().steps.length]).toEqual([0, 1]);

  s.state.offline = false;
  f.fire('connect');
  await settle();
  await settle();
  expect([answered, core.queue.pending().steps.length]).toEqual([1, 0]);
  expect(core.stores.activeRide.getState().driver).toEqual(
    ride('completed', 5),
  );
});

it('queues a position the socket could not deliver and uploads it over HTTP later', async () => {
  const s = server(
    routes({
      'POST /drivers/me/locations': () => ({
        status: 200,
        body: { dropped: 0 },
      }),
    }),
  );
  const f = fakeIo();
  const core = createCore(deps(s, f, 'r'.repeat(43)));
  await core.boot();
  await core.reportPosition({
    lat: 11.55,
    lng: 104.92,
    recordedAt: '2026-11-01T10:00:00.000Z',
  }); // socket not connected
  expect(core.queue.pending().points).toBe(1);
  await core.queue.flush();
  expect(s.calls).toContain('POST /drivers/me/locations');
  expect(core.queue.pending().points).toBe(0);
});

it('signs out completely: secret, stores, queue and socket', async () => {
  const s = server(routes());
  const f = fakeIo();
  const d = deps(s, f, 'r'.repeat(43));
  const core = createCore(d);
  await core.boot();
  f.fire('connect');
  await settle();
  core.queue.enqueuePoint({
    lat: 11.55,
    lng: 104.92,
    recordedAt: '2026-11-01T10:00:00.000Z',
  });

  await core.signOut();

  expect(d.secret()).toBeUndefined();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(core.stores.activeRide.getState().driver).toBeNull();
  expect(core.stores.driverMode.getState().availability).toBeNull();
  expect(core.queue.pending().points).toBe(0);
  expect(f.socket.disconnect).toHaveBeenCalled();
});

it('stays restoring while booting offline, keeps the session, and finishes once the network is back', async () => {
  const s = server(routes());
  s.state.offline = true;
  const f = fakeIo();
  const waits: (() => void)[] = [];
  const d = deps(
    s,
    f,
    'r'.repeat(43),
    () => new Promise<void>(resolve => waits.push(resolve)),
  );
  const core = createCore(d);
  const booting = core.boot();
  await settle();
  expect([core.stores.session.getState().status, waits.length]).toEqual([
    'restoring',
    1,
  ]); // waiting to retry
  waits[0]();
  await settle();
  expect([core.stores.session.getState().status, waits.length]).toEqual([
    'restoring',
    2,
  ]); // still offline
  s.state.offline = false;
  waits[1]();
  await booting;
  expect(core.stores.session.getState()).toMatchObject({
    status: 'signed_in',
    me,
  });
  expect(d.secret()).toBe(pair.refreshToken);
  expect(f.io).toHaveBeenCalledTimes(1);
});

it('drops a command answer that arrives after sign-out, so the next user never sees it', async () => {
  let answer!: () => void;
  const s = server(
    routes({
      'POST /rides': () => ({ status: 201, body: ride('searching', 1) }),
    }),
  );
  const realFetch = s.fetch;
  const core = createCore({
    ...deps(s, fakeIo(), 'r'.repeat(43)),
    fetch: (async (url: string, init: RequestInit) => {
      if (init.method === 'POST' && url.endsWith('/rides'))
        await new Promise<void>(resolve => (answer = resolve));
      return realFetch(url, init);
    }) as typeof fetch,
  });
  await core.boot();
  const booking = core.book('00000000-0000-4000-8000-0000000000aa');
  await settle();
  await core.signOut();
  answer();
  await booking;
  expect(core.stores.activeRide.getState().rider).toBeNull();
});

it('retries only /me (not the refresh) when the server fails it at boot, also on a 5xx', async () => {
  let meCalls = 0;
  const s = server(
    routes({
      'GET /me': () =>
        ++meCalls === 1 ? { status: 503 } : { status: 200, body: me },
    }),
  );
  const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
  await core.boot();
  expect(core.stores.session.getState().status).toBe('signed_in');
  expect(s.calls.filter(c => c === 'POST /auth/refresh')).toHaveLength(1);
});
