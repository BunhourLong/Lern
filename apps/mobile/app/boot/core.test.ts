import { RIDE_UPDATED_EVENT } from '@lern/contracts';
import type { io } from 'socket.io-client';
import type { PushNative } from '../services/push.service';
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
// Notifications refused unless a test says otherwise, so other tests see no registration requests
function fakePush(overrides: Partial<PushNative> = {}) {
  const messages: (() => void)[] = [];
  const native: PushNative = {
    platform: 'android',
    requestPermission: async () => false,
    getToken: async () => 'fcm-token',
    deleteToken: jest.fn(async () => undefined),
    onTokenRefresh: () => () => undefined,
    onMessage: cb => {
      messages.push(cb);
      return () => undefined;
    },
    ...overrides,
  };
  return { native, messages };
}
function deps(
  s: ReturnType<typeof server>,
  f: ReturnType<typeof fakeIo>,
  refresh?: string,
  sleep: () => Promise<void> = async () => undefined,
  push: PushNative = fakePush().native,
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
    push,
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

describe('push', () => {
  const registered = { 'PUT /me/device-token': () => ({ status: 204 }) };
  const count = (calls: string[], route: string) =>
    calls.filter(c => c === route).length;
  const allowed = (overrides: Partial<PushNative> = {}) =>
    fakePush({ requestPermission: async () => true, ...overrides });
  const nap = async () => undefined;

  it('registers the phone once connected, not again on a reconnect', async () => {
    const s = server(routes(registered));
    const f = fakeIo();
    const core = createCore(deps(s, f, 'r'.repeat(43), nap, allowed().native));
    await core.boot();
    expect(count(s.calls, 'PUT /me/device-token')).toBe(0);
    f.fire('connect');
    await settle();
    f.fire('connect');
    await settle();
    expect(count(s.calls, 'PUT /me/device-token')).toBe(1);
  });

  it('reads the snapshot when a push arrives with the app in front', async () => {
    const s = server(routes(registered));
    const f = fakeIo();
    const push = allowed();
    const core = createCore(deps(s, f, 'r'.repeat(43), nap, push.native));
    await core.boot();
    f.fire('connect');
    await settle();
    const before = count(s.calls, 'GET /me/active-ride');
    push.messages[0]();
    await settle();
    expect(count(s.calls, 'GET /me/active-ride')).toBe(before + 1);
  });

  it('gives up the token on sign-out, and on a refused session', async () => {
    const s = server(routes(registered));
    const f = fakeIo();
    const push = allowed();
    const core = createCore(deps(s, f, 'r'.repeat(43), nap, push.native));
    await core.boot();
    f.fire('connect');
    await settle();
    await core.signOut();
    expect(push.native.deleteToken).toHaveBeenCalledTimes(1);

    const refused = server(
      routes({ 'POST /auth/refresh': () => ({ status: 401 }) }),
    );
    const other = allowed();
    const again = createCore(
      deps(refused, fakeIo(), 'r'.repeat(43), nap, other.native),
    );
    await again.boot();
    expect(other.native.deleteToken).toHaveBeenCalledTimes(1);
  });

  // A sign-out while offline couldn't delete it; the next start without a session gets another try
  it('gives up the token when the app starts signed out', async () => {
    const push = allowed();
    const core = createCore(deps(server({}), fakeIo(), undefined, nap, push.native));
    await core.boot();
    expect(push.native.deleteToken).toHaveBeenCalledTimes(1);
  });

  it('registers again for the next user on the same phone', async () => {
    const s = server(
      routes({ ...registered, 'POST /auth/otp/verify': () => ({ status: 200, body: pair }) }),
    );
    const f = fakeIo();
    const core = createCore(deps(s, f, 'r'.repeat(43), nap, allowed().native));
    await core.boot();
    f.fire('connect');
    await settle();
    await core.signOut();
    await core.signIn('+85512345678', '000000');
    f.fire('connect');
    await settle();
    expect(count(s.calls, 'PUT /me/device-token')).toBe(2);
  });

  it('signs out cleanly when the token cannot be deleted', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = server(routes(registered));
    const f = fakeIo();
    const core = createCore(
      deps(
        s,
        f,
        'r'.repeat(43),
        nap,
        allowed({ deleteToken: async () => Promise.reject(new Error('offline')) }).native,
      ),
    );
    await core.boot();
    await core.signOut();
    await settle();
    expect(core.stores.session.getState().status).toBe('signed_out');
    warn.mockRestore();
  });

  it('keeps working when the phone has no token (iOS without APNs)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = server(routes(registered));
    const f = fakeIo();
    const core = createCore(
      deps(
        s,
        f,
        'r'.repeat(43),
        nap,
        allowed({ getToken: async () => Promise.reject(new Error('no APNs')) }).native,
      ),
    );
    await core.boot();
    f.fire('connect');
    await settle();
    expect(core.stores.activeRide.getState().driver).toEqual(ride('in_progress', 4));
    expect(count(s.calls, 'PUT /me/device-token')).toBe(0);
    warn.mockRestore();
  });
});
