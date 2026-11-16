import { RIDE_UPDATED_EVENT } from '@lern/contracts';
import type { io } from 'socket.io-client';
import type { PushNative } from '../services/push.service';
import type { KeyValueStore, SecretStore } from '../services/storage.service';
import { createCore } from './core';

// Deterministic stand-in for SHA-256: depends on salt and PIN, never contains the PIN's digits as written
const fakeHash = async (salt: string, pin: string) =>
  Array.from(`${salt}:${pin}`, c => c.charCodeAt(0).toString(16)).join('');

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
    onAny: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    timeout: () => ({ emitWithAck: async () => ({ dropped: 0 }) }),
  };
  const fire = (e: string, ...a: unknown[]) => handlers.get(e)?.(...a);
  const anyHandler = () =>
    socket.onAny.mock.calls[0][0] as (...a: unknown[]) => void;
  return {
    io: jest.fn(() => socket) as unknown as typeof io,
    socket,
    fire,
    anyHandler,
  };
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
  // A stored token means this install existed before; a test simulating a reinstall removes the flag
  if (refresh !== undefined) m.set('install', '1');
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
  let storedPin: string | undefined;
  const pin: SecretStore = {
    get: async () => storedPin,
    set: async v => {
      storedPin = v;
    },
    clear: async () => {
      storedPin = undefined;
    },
  };
  return {
    baseUrl: 'http://api.test',
    fetch: s.fetch,
    io: f.io,
    kv,
    refreshToken,
    pin,
    pinHasher: {
      salt: () => 'salt',
      hash: fakeHash,
    },
    elapsed: () => 0,
    push,
    sleep,
    appVersion: '1.0',
    secret: () => secret,
    storedPin: () => storedPin,
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

it('drops a stored refresh token when the install flag is missing, as after a reinstall', async () => {
  const s = server(routes());
  const f = fakeIo();
  const d = deps(s, f, 'r'.repeat(43));
  d.kv.remove('install'); // MMKV was wiped by the uninstall; the Keychain token survived it
  const core = createCore(d);
  await core.boot();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(d.secret()).toBeUndefined();
  expect(d.kv.get('install')).toBe('1');
  expect(f.io).not.toHaveBeenCalled();
});

it('sets the install flag only after the stale token is gone, so a crash in between retries next boot', async () => {
  const s = server(routes());
  const f = fakeIo();
  const d = deps(s, f, 'r'.repeat(43));
  d.kv.remove('install'); // MMKV was wiped by the uninstall; the Keychain token survived it
  const clear = d.refreshToken.clear;
  let crash = true;
  d.refreshToken.clear = async () => {
    if (crash) {
      crash = false;
      throw new Error('killed before the clear finished'); // the app dies inside the check
    }
    await clear();
  };
  const core = createCore(d);
  await expect(core.boot()).rejects.toThrow('killed before the clear finished');
  expect(d.kv.get('install')).toBeUndefined(); // the flag must not precede the clear
  await core.boot();
  expect(d.secret()).toBeUndefined();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(f.io).not.toHaveBeenCalled();
});

it('keeps the stored refresh token when the install flag is present', async () => {
  const s = server(routes());
  const f = fakeIo();
  const d = deps(s, f, 'r'.repeat(43));
  const core = createCore(d);
  await core.boot();
  expect(core.stores.session.getState()).toMatchObject({
    status: 'signed_in',
    me,
  });
  expect(d.secret()).toBe(pair.refreshToken);
});

it('sets the install flag on a fresh install with no stored token', async () => {
  const f = fakeIo();
  const d = deps(server(routes()), f);
  const core = createCore(d);
  await core.boot();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(d.kv.get('install')).toBe('1');
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

  expect(s.calls).toContain('POST /auth/logout');
  expect(d.secret()).toBeUndefined();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(core.stores.activeRide.getState().driver).toBeNull();
  expect(core.stores.driverMode.getState().availability).toBeNull();
  expect(core.queue.pending().points).toBe(0);
  expect(f.socket.disconnect).toHaveBeenCalled();
});

it('reports the socket as connected only while it is, and not after sign-out', async () => {
  const s = server(routes());
  const f = fakeIo();
  const core = createCore(deps(s, f, 'r'.repeat(43)));
  await core.boot();
  const connected = () => core.stores.connection.getState().connected;
  expect(connected()).toBe(false); // booted, but the socket has not connected yet
  f.fire('connect');
  expect(connected()).toBe(true);
  f.fire('disconnect', 'transport close');
  expect(connected()).toBe(false);
  f.fire('connect'); // back after the drop
  expect(connected()).toBe(true);
  await settle();
  await core.signOut();
  expect(connected()).toBe(false);
});

it('logs raw socket events, and sign-out empties the log', async () => {
  const f = fakeIo();
  const core = createCore(deps(server(routes()), f, 'r'.repeat(43)));
  await core.boot();
  f.anyHandler()('ride.updated', { id: 'x' });
  expect(core.stores.rawEvents.getState().events[0]).toMatchObject({
    event: 'ride.updated',
    payload: { id: 'x' },
  });
  await core.signOut();
  expect(core.stores.rawEvents.getState().events).toEqual([]);
});

it('closes the previous socket when a session starts again, so none outlives sign-out', async () => {
  const first = fakeIo();
  const second = fakeIo();
  const d = deps(server(routes()), first, 'r'.repeat(43));
  const core = createCore({
    ...d,
    io: jest
      .fn()
      .mockReturnValueOnce(first.socket)
      .mockReturnValueOnce(second.socket) as unknown as typeof io,
  });
  await core.boot();
  await core.boot(); // starts the session again, as a second Verify does
  expect(first.socket.disconnect).toHaveBeenCalledTimes(1);
  await core.signOut();
  expect(second.socket.disconnect).toHaveBeenCalledTimes(1);
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

const androidStoreUrl =
  'https://play.google.com/store/apps/details?id=com.lern';

describe('app config', () => {
  const config = (maintenance = false) => ({
    maintenance,
    ios: null,
    android: { minVersion: '9.0', storeUrl: androidStoreUrl },
  });

  it('asks for an update when the app is below the platform minimum', async () => {
    const s = server(
      routes({ 'GET /app-config': () => ({ status: 200, body: config() }) }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().gate).toEqual({
      status: 'update_required',
      storeUrl: androidStoreUrl,
    });
  });

  it('goes into maintenance when the config says so', async () => {
    const s = server(
      routes({
        'GET /app-config': () => ({ status: 200, body: config(true) }),
      }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().gate).toEqual({
      status: 'maintenance',
    });
  });

  it('stays ok when /app-config is unreachable, and the session still boots', async () => {
    const s = server(routes()); // no route: the request fails at the network
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().gate).toEqual({ status: 'ok' });
    expect(core.stores.session.getState().status).toBe('signed_in');
  });

  it('stays ok when /app-config answers a body the contract rejects', async () => {
    const s = server(
      routes({
        'GET /app-config': () => ({
          status: 200,
          body: { maintenance: 'yes', ios: null, android: null },
        }),
      }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().gate).toEqual({ status: 'ok' });
  });

  it('does not wait for /app-config before restoring the session', async () => {
    const s = server(routes());
    const realFetch = s.fetch;
    let answer!: () => void;
    const core = createCore({
      ...deps(s, fakeIo(), 'r'.repeat(43)),
      fetch: (async (url: string, init: RequestInit) => {
        if (init.method === 'GET' && url.endsWith('/app-config'))
          await new Promise<void>(resolve => (answer = resolve)); // no answer until the test allows one
        return realFetch(url, init);
      }) as typeof fetch,
    });
    await core.boot();
    expect(core.stores.session.getState().status).toBe('signed_in');
    expect(core.stores.appConfig.getState().gate).toBeNull();
    answer(); // only now does /app-config answer; before this boot had already resolved
    await settle();
  });

  it('keeps the gate on sign-out: it is not per user', async () => {
    const s = server(
      routes({
        'GET /app-config': () => ({ status: 200, body: config(true) }),
        'POST /auth/logout': () => ({ status: 204 }),
      }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().gate).toEqual({
      status: 'maintenance',
    });

    await core.signOut();
    await settle();

    expect(core.stores.appConfig.getState().gate).toEqual({
      status: 'maintenance',
    });
    expect(core.stores.session.getState().status).toBe('signed_out');
  });
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

describe('app lock', () => {
  const PIN = '123456';
  const signedIn = async (d: ReturnType<typeof deps>) => {
    const core = createCore(d);
    await core.boot();
    return core;
  };

  it('is off and unlocked by default', async () => {
    const core = await signedIn(
      deps(server(routes()), fakeIo(), 'r'.repeat(43)),
    );
    expect(core.stores.security.getState()).toMatchObject({
      enabled: false,
      locked: false,
    });
  });

  it('boots locked when a PIN is set, and the right PIN unlocks', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    await (await signedIn(d)).enableLock(PIN);
    const core = await signedIn(d); // next launch
    expect(core.stores.security.getState()).toMatchObject({
      enabled: true,
      locked: true,
    });
    expect(await core.unlock('000000')).toEqual({ ok: false, waitMs: 0 });
    expect(core.stores.security.getState().locked).toBe(true);
    expect(await core.unlock(PIN)).toEqual({ ok: true });
    expect(core.stores.security.getState()).toMatchObject({
      locked: false,
      waitMs: 0,
    });
  });

  it('boots locked when the Keychain refuses to say whether a PIN is set', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    d.pin.get = () => Promise.reject(new Error('keychain'));
    const core = await signedIn(d);
    expect(core.stores.security.getState().locked).toBe(true);
  });

  it('lock() locks only when a PIN is set', async () => {
    const core = await signedIn(
      deps(server(routes()), fakeIo(), 'r'.repeat(43)),
    );
    core.lock();
    expect(core.stores.security.getState().locked).toBe(false);
    await core.enableLock(PIN);
    core.lock();
    expect(core.stores.security.getState().locked).toBe(true);
  });

  it('shows the wait after the 5th wrong PIN', async () => {
    const core = await signedIn(
      deps(server(routes()), fakeIo(), 'r'.repeat(43)),
    );
    await core.enableLock(PIN);
    core.lock();
    for (let i = 0; i < 5; i++) await core.unlock('000000');
    expect(core.stores.security.getState()).toMatchObject({
      locked: true,
      waitMs: 30_000,
    });
  });

  it('the 10th wrong PIN signs out and clears the lock', async () => {
    const s = server(routes());
    let t = 0;
    const d = { ...deps(s, fakeIo(), 'r'.repeat(43)), elapsed: () => t };
    const core = await signedIn(d);
    await core.enableLock(PIN);
    core.lock();
    let last;
    for (let i = 0; i < 10; i++) {
      t += 10_000_000; // past every wait
      last = await core.unlock('000000');
    }
    expect(last).toEqual({ ok: false, wiped: true });
    expect(s.calls).toContain('POST /auth/logout');
    expect(d.secret()).toBeUndefined();
    expect(d.storedPin()).toBeUndefined();
    expect(core.stores.session.getState().status).toBe('signed_out');
    expect(core.stores.security.getState()).toMatchObject({
      enabled: false,
      locked: false,
    });
  });

  it('disableLock needs the right PIN', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    await core.enableLock(PIN);
    expect(await core.disableLock('000000')).toEqual({ ok: false, waitMs: 0 });
    expect(core.stores.security.getState().enabled).toBe(true);
    expect(await core.disableLock(PIN)).toEqual({ ok: true });
    expect(core.stores.security.getState().enabled).toBe(false);
    expect(d.storedPin()).toBeUndefined();
  });

  it('changePin needs the old PIN', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    await core.enableLock(PIN);
    expect(await core.changePin(PIN, '222222')).toEqual({ ok: true });
    core.lock();
    expect(await core.unlock(PIN)).toEqual({ ok: false, waitMs: 0 });
    expect(await core.unlock('222222')).toEqual({ ok: true });
  });

  it('any sign-out clears the PIN, so the next user on this phone is not locked out', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    await core.enableLock(PIN);
    core.lock();
    await core.signOut();
    await settle();
    expect(d.storedPin()).toBeUndefined();
    expect(core.stores.security.getState()).toMatchObject({
      enabled: false,
      locked: false,
    });
  });

  it('enableLock leaves the lock off when the Keychain refuses the PIN', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    d.pin.set = () => Promise.reject(new Error('keychain'));
    const core = await signedIn(d);
    await expect(core.enableLock(PIN)).rejects.toThrow();
    expect(core.stores.security.getState().enabled).toBe(false);
  });

  it('boots with the wait that is still running, for the countdown', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const first = await signedIn(d);
    await first.enableLock(PIN);
    for (let i = 0; i < 5; i++) await first.unlock('000000');
    const core = await signedIn(d); // next launch
    expect(core.stores.security.getState()).toMatchObject({
      locked: true,
      waitMs: 30_000,
    });
  });

  it('a reinstall drops a PIN the iOS Keychain kept', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    await (await signedIn(d)).enableLock(PIN);
    d.kv.remove('install');
    const core = await signedIn(d);
    expect(d.storedPin()).toBeUndefined();
    expect(core.stores.security.getState().locked).toBe(false);
  });
});
