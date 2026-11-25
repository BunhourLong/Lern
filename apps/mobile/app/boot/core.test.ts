import {
  type DriverProfile,
  OFFER_UPDATED_EVENT,
  RIDE_UPDATED_EVENT,
} from '@lern/contracts';
import type { io } from 'socket.io-client';
import { rootRoute } from '../routes/root-route';
import { ApiError } from '../services/api.service';
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
const otherRideId = '00000000-0000-4000-8000-000000000002';
const offerId = '00000000-0000-4000-8000-000000000003';
const rideTap = { type: 'ride', rideId, seq: '4' };
const offerTap = { type: 'offer', rideId, offerId };
const ride = (status: string, version: number) => ({
  id: rideId,
  status,
  version,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 4000, currency: 'KHR' },
});
const offer = {
  ...ride('pending', 1),
  id: offerId,
  rideId,
  distanceM: 800,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const pair = { accessToken: 'access-2', refreshToken: 'r'.repeat(43) };
type Reply = { status: number; body?: unknown };
type Routes = Record<string, () => Reply | Promise<Reply>>;

// A server keyed by "METHOD /path"; offline = every request fails at the network
function server(routes: Routes) {
  const calls: string[] = [];
  const state = { offline: false };
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    const route = `${init.method} ${url.replace('http://api.test', '')}`;
    calls.push(route);
    if (state.offline || !routes[route])
      throw new TypeError('Network request failed');
    const { status, body } = await routes[route]();
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
  const opened: ((data: unknown) => void)[] = [];
  const unsubscribeOpen = jest.fn();
  const native: PushNative = {
    platform: 'android',
    locale: () => 'en',
    requestPermission: async () => false,
    getToken: async () => 'fcm-token',
    deleteToken: jest.fn(async () => undefined),
    onTokenRefresh: () => () => undefined,
    onMessage: cb => {
      messages.push(cb);
      return () => undefined;
    },
    onNotificationOpenedApp: cb => {
      opened.push(cb);
      return unsubscribeOpen;
    },
    getInitialNotification: async () => null,
    ...overrides,
  };
  return { native, messages, opened, unsubscribeOpen };
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
    deviceLocale: () => 'en-US',
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
const routes = (extra: Routes = {}) => ({
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

const driverApplication = { vehicleType: 'remork', plate: 'PP 1' } as const;
const pendingProfile = {
  ...driverApplication,
  verification: 'pending',
  availability: 'offline',
};
const rider = { ...me, roles: ['rider'] };

it.each([201, 409])(
  'reloads the session and driver profile after applying (HTTP %i)',
  async status => {
    let applied = false;
    const s = server(
      routes({
        'GET /me': () => ({ status: 200, body: applied ? me : rider }),
        'POST /drivers/me': () => {
          applied = true;
          return { status, body: status === 201 ? pendingProfile : undefined };
        },
        'GET /drivers/me': () => ({ status: 200, body: pendingProfile }),
      }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();

    await core.becomeDriver(driverApplication);

    expect(s.calls.slice(-3)).toEqual([
      'POST /drivers/me',
      'GET /me',
      'GET /drivers/me',
    ]);
    expect(core.stores.session.getState().me).toEqual(me);
    expect(core.stores.driverMode.getState()).toMatchObject({
      verification: 'pending',
      availability: 'offline',
    });
  },
);

it('rethrows an application failure and keeps the rider session', async () => {
  const s = server(
    routes({
      'GET /me': () => ({ status: 200, body: rider }),
      'POST /drivers/me': () => ({ status: 500 }),
    }),
  );
  const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
  await core.boot();
  const previous = core.stores.session.getState();

  await expect(core.becomeDriver(driverApplication)).rejects.toEqual(
    new ApiError(500, null),
  );

  expect(core.stores.session.getState()).toBe(previous);
  expect(s.calls.slice(-2)).toEqual(['GET /me', 'POST /drivers/me']);
});

it('skips the role lookup after sign-out during the driver application', async () => {
  let finish!: () => void;
  const s = server(
    routes({
      'GET /me': () => ({ status: 200, body: rider }),
      'POST /drivers/me': () =>
        new Promise(resolve => {
          finish = () => resolve({ status: 201, body: pendingProfile });
        }),
      'POST /auth/logout': () => ({ status: 204 }),
    }),
  );
  const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
  await core.boot();
  const application = core.becomeDriver(driverApplication);
  await settle();
  await core.signOut();
  const callsAtSignOut = s.calls.length;
  finish();
  await application;

  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(s.calls.slice(callsAtSignOut)).not.toContain('GET /me');
});

it('does not restore a driver session after sign-out during the role lookup', async () => {
  let reply = () => Promise.resolve({ status: 200, body: rider });
  const s = server(
    routes({
      'GET /me': () => reply(),
      'POST /drivers/me': () => ({ status: 201, body: pendingProfile }),
      'POST /auth/logout': () => ({ status: 204 }),
    }),
  );
  const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
  await core.boot();
  let finish!: () => void;
  reply = () =>
    new Promise(resolve => {
      finish = () => resolve({ status: 200, body: me });
    });
  const application = core.becomeDriver(driverApplication);
  await settle();
  await core.signOut();
  finish();
  await application;

  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(core.stores.driverMode.getState().verification).toBeNull();
  expect(s.calls).not.toContain('GET /drivers/me');
});

it('retries the profile load without verifying a consumed OTP again', async () => {
  let profileReady = false;
  const verify = jest
    .fn<{ status: number; body?: unknown }, []>()
    .mockReturnValueOnce({ status: 200, body: pair })
    .mockReturnValue({ status: 401 });
  const s = server(
    routes({
      'POST /auth/otp/verify': verify,
      'GET /me': () => {
        if (!profileReady) throw new TypeError('Network request failed');
        return { status: 200, body: me };
      },
    }),
  );
  const core = createCore(deps(s, fakeIo()));

  await expect(core.signIn(me.phone, '123456')).rejects.toMatchObject({
    status: 0,
  });
  profileReady = true;
  await core.signIn(me.phone, '123456');

  expect(s.calls.filter(call => call === 'GET /me')).toHaveLength(2);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(core.stores.session.getState().status).toBe('signed_in');
});

it('verifies a different phone after the first phone could not load its profile', async () => {
  let profileReady = false;
  const verify = jest
    .fn<{ status: number; body?: unknown }, []>()
    .mockReturnValueOnce({ status: 200, body: pair })
    .mockReturnValue({ status: 401 });
  const s = server(
    routes({
      'POST /auth/otp/verify': verify,
      'GET /me': () => {
        if (!profileReady) throw new TypeError('Network request failed');
        return { status: 200, body: me };
      },
    }),
  );
  const core = createCore(deps(s, fakeIo()));

  await expect(core.signIn(me.phone, '123456')).rejects.toMatchObject({
    status: 0,
  });
  profileReady = true;
  const phone = '+85598765432';
  const code = '654321';
  await expect(core.signIn(phone, code)).rejects.toMatchObject({ status: 401 });

  expect(jest.mocked(s.fetch)).toHaveBeenCalledWith(
    'http://api.test/auth/otp/verify',
    expect.objectContaining({ body: JSON.stringify({ phone, code }) }),
  );
});

it('verifies the same phone again after signing out before the profile loaded', async () => {
  let profileReady = false;
  const s = server(
    routes({
      'POST /auth/otp/verify': () => ({ status: 200, body: pair }),
      'POST /auth/logout': () => ({ status: 204 }),
      'GET /me': () => {
        if (!profileReady) throw new TypeError('Network request failed');
        return { status: 200, body: me };
      },
    }),
  );
  const core = createCore(deps(s, fakeIo()));

  await expect(core.signIn(me.phone, '123456')).rejects.toMatchObject({
    status: 0,
  });
  await core.signOut();
  expect(core.api.accessToken()).toBeUndefined();

  profileReady = true;
  await core.signIn(me.phone, '654321');
  expect(s.calls.filter(call => call === 'POST /auth/otp/verify')).toHaveLength(
    2,
  );
});

it('verifies the original phone again after storing another phone’s refresh token fails', async () => {
  let profileReady = false;
  const otherPair = { accessToken: 'other-access', refreshToken: 's'.repeat(43) };
  const verify = jest
    .fn(() => ({ status: 200, body: pair }))
    .mockReturnValueOnce({ status: 200, body: pair })
    .mockReturnValueOnce({ status: 200, body: otherPair });
  const s = server(
    routes({
      'POST /auth/otp/verify': verify,
      'GET /me': () => {
        if (!profileReady) throw new TypeError('Network request failed');
        return { status: 200, body: me };
      },
    }),
  );
  const d = deps(s, fakeIo());
  const core = createCore(d);

  await expect(core.signIn(me.phone, '123456')).rejects.toMatchObject({
    status: 0,
  });
  const storageError = new Error('Could not save refresh token');
  jest.spyOn(d.refreshToken, 'set').mockRejectedValueOnce(storageError);
  await expect(core.signIn('+85598765432', '234567')).rejects.toBe(storageError);
  expect(core.api.accessToken()).toBe(otherPair.accessToken);

  profileReady = true;
  await core.signIn(me.phone, '345678');
  expect(verify).toHaveBeenCalledTimes(3);
  expect(core.api.accessToken()).toBe(pair.accessToken);
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
  expect(core.stores.driverMode.getState().verification).toBe('verified');

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
  const point = {
    lat: 11.55,
    lng: 104.92,
    recordedAt: '2026-11-01T10:00:00.000Z',
  };
  await core.reportPosition(point); // socket not connected
  expect(core.stores.driverMode.getState().position).toEqual(point);
  expect(core.queue.pending().points).toBe(1);
  await core.queue.flush();
  expect(s.calls).toContain('POST /drivers/me/locations');
  expect(core.queue.pending().points).toBe(0);
});

it('updates the driver position when the socket delivers it', async () => {
  const f = fakeIo();
  const core = createCore(deps(server(routes()), f, 'r'.repeat(43)));
  await core.boot();
  f.socket.connected = true;
  const point = { lat: 11.55, lng: 104.92, recordedAt: '2026-11-21T10:00:00Z' };
  await core.reportPosition(point);
  expect(core.stores.driverMode.getState().position).toEqual(point);
  expect(core.queue.pending().points).toBe(0);
});

it('drops a pending location acknowledgement after sign-out', async () => {
  const f = fakeIo();
  const core = createCore(deps(server(routes()), f, 'r'.repeat(43)));
  await core.boot();
  f.socket.connected = true;
  let refuse!: (cause: Error) => void;
  jest.spyOn(f.socket, 'timeout').mockReturnValueOnce({
    emitWithAck: () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
  });
  const report = core.reportPosition({
    lat: 11.55,
    lng: 104.92,
    recordedAt: '2026-11-21T10:00:00Z',
  });
  await core.signOut();
  refuse(new Error('disconnected while sending location'));
  await report;
  expect(core.stores.driverMode.getState().position).toBeNull();
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
  await core.reportPosition({
    lat: 11.55,
    lng: 104.92,
    recordedAt: '2026-11-01T10:00:00.000Z',
  });
  core.stores.driverMode.setState({ locationPermission: 'foreground' });

  expect(core.stores.driverMode.getState().position).not.toBeNull();
  const callsAtSignOut = s.calls.length;
  await core.signOut();

  expect(s.calls.slice(callsAtSignOut)).not.toContain('GET /drivers/me');
  expect(s.calls).toContain('POST /auth/logout');
  expect(d.secret()).toBeUndefined();
  expect(core.stores.session.getState().status).toBe('signed_out');
  expect(core.stores.activeRide.getState().driver).toBeNull();
  expect(core.stores.driverMode.getState().availability).toBeNull();
  expect(core.stores.driverMode.getState().verification).toBeNull();
  expect(core.stores.driverMode.getState().locationPermission).toBeNull();
  expect(core.stores.driverMode.getState().position).toBeNull();
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

it('keeps the language override on sign-out', async () => {
  const s = server(routes({ 'POST /auth/logout': () => ({ status: 204 }) }));
  const d = deps(s, fakeIo(), pair.refreshToken);
  const core = createCore(d);
  await core.boot();
  core.stores.language.getState().setOverride('km');

  await core.signOut();

  expect(s.calls).toContain('POST /auth/logout');
  expect(core.stores.language.getState()).toMatchObject({
    language: 'km',
    override: 'km',
  });
  expect(d.kv.get('language')).toBe('km');
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

describe('session cache', () => {
  const cacheKey = 'session-cache.v1';
  const cachedDriver = JSON.stringify({ me, verification: 'verified' });

  function restart(d: ReturnType<typeof deps>) {
    let retry!: () => void;
    const core = createCore({
      ...d,
      io: fakeIo().io,
      sleep: () => new Promise<void>(resolve => (retry = resolve)),
    });
    return { core, retry: () => retry() };
  }

  it('opens Driver Home offline, then applies fresh account data and keeps the queued step', async () => {
    const freshMe = { ...me, phone: '+85598765432' };
    const freshProfile = { ...pendingProfile, verification: 'suspended' };
    let fresh = false;
    const s = server(
      routes({
        'POST /auth/otp/verify': () => ({ status: 200, body: pair }),
        'GET /me': () => ({ status: 200, body: fresh ? freshMe : me }),
        'GET /drivers/me': () => ({
          status: 200,
          body: fresh
            ? freshProfile
            : {
                ...pendingProfile,
                verification: 'verified',
                availability: 'on_trip',
              },
        }),
      }),
    );
    const d = deps(s, fakeIo());
    const first = createCore(d);
    await first.boot();
    await first.signIn(me.phone, '123456');
    s.state.offline = true;
    await first.step(rideId, 'complete');
    const queued = first.queue.pending().steps;
    expect(queued).toHaveLength(1);

    const { core, retry } = restart(d);
    const booting = core.boot();
    await settle();

    const { session, driverMode, appConfig, connection } = core.stores;
    expect(session.getState()).toMatchObject({ status: 'signed_in', me });
    expect(driverMode.getState()).toMatchObject({
      verification: 'verified',
      availability: null,
    });
    expect(rootRoute(session.getState(), appConfig.getState().gate)).toBe(
      'driver',
    );
    expect(connection.getState().connected).toBe(false);
    expect(JSON.parse(d.kv.get(cacheKey)!)).toEqual({
      me,
      verification: 'verified',
    });

    fresh = true;
    s.state.offline = false;
    retry();
    await booting;

    expect(session.getState().me).toEqual(freshMe);
    expect(driverMode.getState()).toMatchObject({
      verification: 'suspended',
      availability: 'offline',
    });
    expect(core.queue.pending().steps).toEqual(queued);
    expect(JSON.parse(d.kv.get(cacheKey)!)).toEqual({
      me: freshMe,
      verification: 'suspended',
    });
  });

  it('leaves cached availability and verification alone on foreground before boot retries', async () => {
    let restored = false;
    const s = server(
      routes({
        'POST /auth/refresh': () => {
          restored = true;
          return { status: 200, body: pair };
        },
        'GET /drivers/me': () =>
          restored
            ? {
                status: 200,
                body: { ...pendingProfile, availability: 'on_trip' },
              }
            : { status: 401 },
      }),
    );
    const d = deps(s, fakeIo(), pair.refreshToken);
    d.kv.set(cacheKey, cachedDriver);
    s.state.offline = true;
    const { core, retry } = restart(d);
    const booting = core.boot();
    await settle();
    const { session, driverMode } = core.stores;
    expect(session.getState()).toMatchObject({ status: 'signed_in', me });

    s.state.offline = false;
    await core.refreshAvailability();

    expect({
      ...driverMode.getState(),
      cache: d.kv.get(cacheKey),
    }).toMatchObject({
      availability: null,
      verification: 'verified',
      cache: cachedDriver,
    });
    expect(s.calls).not.toContain('GET /drivers/me');

    retry();
    await booting;
    expect(driverMode.getState()).toMatchObject({
      availability: 'on_trip',
      verification: 'pending',
    });
  });

  it('opens Rider Home for a cached rider while offline', async () => {
    const s = server(
      routes({ 'GET /me': () => ({ status: 200, body: rider }) }),
    );
    const d = deps(s, fakeIo(), pair.refreshToken);
    await createCore(d).boot();
    s.state.offline = true;
    const { core } = restart(d);
    await Promise.race([core.boot(), settle()]);

    const { session, appConfig } = core.stores;
    expect(session.getState()).toMatchObject({
      status: 'signed_in',
      me: rider,
    });
    expect(rootRoute(session.getState(), appConfig.getState().gate)).toBe(
      'rider',
    );
    expect(JSON.parse(d.kv.get(cacheKey)!)).toEqual({
      me: rider,
      verification: null,
    });
  });

  it('keeps a cold notification tap until the cached session is confirmed', async () => {
    const s = server(routes());
    const push = fakePush({ getInitialNotification: async () => rideTap });
    const d = deps(s, fakeIo(), pair.refreshToken, undefined, push.native);
    d.kv.set(cacheKey, cachedDriver);
    s.state.offline = true;
    const { core, retry } = restart(d);
    const booting = core.boot();
    await settle();

    expect(s.calls).not.toContain('GET /me/active-ride');
    s.state.offline = false;
    retry();
    await booting;
    await settle();

    expect(core.stores.notification.getState()).toEqual({
      type: 'ride',
      id: rideId,
      status: 'in_progress',
    });
  });

  it('clears the cached account before starting a different account from the stored token', async () => {
    const otherUser = {
      ...me,
      id: '00000000-0000-4000-8000-0000000000d2',
      phone: '+85598765432',
    };
    let answerProfile!: () => void;
    const s = server(
      routes({
        'GET /me': () => ({ status: 200, body: otherUser }),
        'GET /drivers/me': () =>
          new Promise<Reply>(resolve => {
            answerProfile = () => resolve({ status: 200, body: pendingProfile });
          }),
      }),
    );
    const push = fakePush({ getInitialNotification: async () => rideTap });
    const d = deps(s, fakeIo(), pair.refreshToken, undefined, push.native);
    d.kv.set(cacheKey, cachedDriver);
    s.state.offline = true;
    const { core, retry } = restart(d);
    const booting = core.boot();
    await settle();
    const { session, driverMode, notification } = core.stores;
    expect(session.getState()).toMatchObject({ status: 'signed_in', me });
    expect(driverMode.getState().verification).toBe('verified');

    s.state.offline = false;
    retry();
    await settle();
    const whileLoadingProfile = {
      session: session.getState(),
      driverMode: driverMode.getState(),
      cache: d.kv.get(cacheKey),
    };
    answerProfile();
    await booting;
    await settle();

    expect(whileLoadingProfile).toMatchObject({
      session: { status: 'signed_out', me: null },
      driverMode: { availability: null, verification: null },
      cache: undefined,
    });
    expect(session.getState()).toMatchObject({
      status: 'signed_in',
      me: otherUser,
    });
    expect(driverMode.getState()).toMatchObject({
      availability: 'offline',
      verification: 'pending',
    });
    expect(JSON.parse(d.kv.get(cacheKey) ?? 'null')).toEqual({
      me: otherUser,
      verification: 'pending',
    });
    expect(s.calls).not.toContain('GET /me/active-ride');
    expect(notification.getState()).toBeNull();
  });

  it('clears the cache on sign-out even if Keychain leaves a token for the next offline boot', async () => {
    const s = server(routes());
    const d = deps(s, fakeIo(), pair.refreshToken);
    const first = createCore(d);
    await first.boot();
    d.kv.set(cacheKey, cachedDriver);
    jest
      .spyOn(d.refreshToken, 'clear')
      .mockRejectedValueOnce(new Error('Keychain'));
    s.state.offline = true;

    await first.signOut();
    expect(d.kv.get(cacheKey)).toBeUndefined();
    const { core } = restart(d);
    await Promise.race([core.boot(), settle()]);

    expect(core.stores.session.getState()).toMatchObject({
      status: 'restoring',
      me: null,
    });
  });

  it('keeps the cache cleared when a boot response arrives after sign-out', async () => {
    let answerMe!: () => void;
    const s = server(
      routes({
        'GET /me': () =>
          new Promise<Reply>(resolve => {
            answerMe = () => resolve({ status: 200, body: me });
          }),
      }),
    );
    const d = deps(s, fakeIo(), pair.refreshToken);
    d.kv.set(cacheKey, cachedDriver);
    const core = createCore(d);
    const booting = core.boot();
    await settle();

    await core.signOut();
    answerMe();
    await booting;

    expect(core.stores.session.getState().status).toBe('signed_out');
    expect(d.kv.get(cacheKey)).toBeUndefined();
  });

  it('discards an availability refresh that finishes after sign-out', async () => {
    let reply = async () => ({ status: 200, body: pendingProfile });
    const s = server(routes({ 'GET /drivers/me': () => reply() }));
    const d = deps(s, fakeIo(), pair.refreshToken);
    const core = createCore(d);
    await core.boot();
    expect(d.kv.get(cacheKey)).toBeDefined();

    let answerProfile!: () => void;
    reply = () =>
      new Promise(resolve => {
        answerProfile = () =>
          resolve({
            status: 200,
            body: {
              ...pendingProfile,
              availability: 'on_trip',
              verification: 'verified',
            },
          });
      });
    const refresh = core.refreshAvailability();
    await settle();
    await core.signOut();
    const { driverMode } = core.stores;
    const signedOutMode = driverMode.getState();
    expect(d.kv.get(cacheKey)).toBeUndefined();

    answerProfile();
    await refresh;

    expect({
      driverMode: driverMode.getState(),
      cache: d.kv.get(cacheKey),
    }).toEqual({ driverMode: signedOutMode, cache: undefined });
  });

  it.each(['at boot', 'while signed in'] as const)(
    'clears the cache after a refused refresh %s',
    async when => {
      let refused = when === 'at boot';
      const s = server(
        routes({
          'POST /auth/refresh': () =>
            refused ? { status: 401 } : { status: 200, body: pair },
        }),
      );
      const d = deps(s, fakeIo(), pair.refreshToken);
      d.kv.set(cacheKey, cachedDriver);
      const core = createCore(d);
      await core.boot();
      if (when === 'while signed in') {
        refused = true;
        expect(await core.api.restore()).toBe('refused');
      }

      expect(core.stores.session.getState()).toMatchObject({
        status: 'signed_out',
        me: null,
      });
      expect(d.kv.get(cacheKey)).toBeUndefined();
    },
  );

  it('clears a leftover cache when boot finds no refresh token', async () => {
    const d = deps(server(routes()), fakeIo(), pair.refreshToken);
    await d.refreshToken.clear();
    d.kv.set(cacheKey, cachedDriver);
    const core = createCore(d);
    await core.boot();

    expect(core.stores.session.getState()).toMatchObject({
      status: 'signed_out',
      me: null,
    });
    expect(core.stores.driverMode.getState().verification).toBeNull();
    expect(d.kv.get(cacheKey)).toBeUndefined();
  });

  it.each([
    ['bad JSON', '{'],
    [
      'invalid account',
      JSON.stringify({ me: { id: me.id }, verification: 'verified' }),
    ],
    ['invalid verification', JSON.stringify({ me, verification: 'unknown' })],
  ])(
    'discards a cache with %s and stays restoring offline',
    async (_, value) => {
      const s = server(routes());
      s.state.offline = true;
      const d = deps(s, fakeIo(), pair.refreshToken);
      d.kv.set(cacheKey, value);
      const { core } = restart(d);
      await Promise.race([core.boot(), settle()]);

      expect(core.stores.session.getState()).toMatchObject({
        status: 'restoring',
        me: null,
      });
      expect(d.kv.get(cacheKey)).toBeUndefined();
    },
  );

  it('locks the app before exposing the cached session when booting offline', async () => {
    const s = server(routes());
    const d = deps(s, fakeIo(), pair.refreshToken);
    const first = createCore(d);
    await first.boot();
    await first.enableLock('123456');
    d.kv.set(cacheKey, cachedDriver);
    s.state.offline = true;
    const { core } = restart(d);
    const { session, security } = core.stores;
    const lockedAtSignIn: boolean[] = [];
    session.subscribe(state => {
      if (state.status === 'signed_in')
        lockedAtSignIn.push(security.getState().locked);
    });
    await Promise.race([core.boot(), settle()]);

    expect(lockedAtSignIn).toEqual([true]);
  });

  it('caches the new roles and verification after a rider becomes a driver', async () => {
    let applied = false;
    const s = server(
      routes({
        'GET /me': () => ({ status: 200, body: applied ? me : rider }),
        'POST /drivers/me': () => {
          applied = true;
          return { status: 201, body: pendingProfile };
        },
        'GET /drivers/me': () => ({ status: 200, body: pendingProfile }),
      }),
    );
    const d = deps(s, fakeIo(), pair.refreshToken);
    const core = createCore(d);
    await core.boot();
    await core.becomeDriver(driverApplication);

    expect(JSON.parse(d.kv.get(cacheKey) ?? 'null')).toEqual({
      me,
      verification: 'pending',
    });
  });

  it('uses the verification learned on socket connect on the next offline boot', async () => {
    let verification = 'pending';
    const s = server(
      routes({
        'GET /drivers/me': () => ({
          status: 200,
          body: { ...pendingProfile, verification },
        }),
      }),
    );
    const socket = fakeIo();
    const d = deps(s, socket, pair.refreshToken);
    const first = createCore(d);
    await first.boot();
    expect(first.stores.driverMode.getState().verification).toBe('pending');
    verification = 'verified';
    socket.fire('connect');
    await settle();
    expect(first.stores.driverMode.getState().verification).toBe('verified');

    s.state.offline = true;
    const { core } = restart(d);
    await Promise.race([core.boot(), settle()]);

    expect(core.stores.driverMode.getState().verification).toBe('verified');
  });
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
    khrPerUsd: 4000,
  });

  it('keeps the riel-per-dollar rate for the approximate USD display', async () => {
    const s = server(
      routes({ 'GET /app-config': () => ({ status: 200, body: config() }) }),
    );
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().khrPerUsd).toBe(4000);
  });

  it('leaves the rate unknown when /app-config is unreachable', async () => {
    const s = server(routes()); // no route: the request fails at the network
    const core = createCore(deps(s, fakeIo(), 'r'.repeat(43)));
    await core.boot();
    await settle();
    expect(core.stores.appConfig.getState().khrPerUsd).toBeNull();
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
  const active = 'GET /me/active-ride';
  const details = `GET /rides/${rideId}`;
  const emptyRides = { rider: null, driver: null, offer: null };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => (resolve = done));
    return { promise, resolve };
  }

  async function bootPush(extra: Routes = {}, overrides: Partial<PushNative> = {}) {
    const s = server(routes(extra));
    const push = fakePush(overrides);
    const socket = fakeIo();
    const core = createCore(deps(s, socket, pair.refreshToken, nap, push.native));
    await core.boot();
    await settle();
    return { core, push, s, socket, open: push.opened[0] };
  }

  it('refreshes a cold notification tap before the socket connects', async () => {
    const config = deferred<Reply>();
    const { core, s } = await bootPush(
      { 'GET /app-config': () => config.promise },
      { getInitialNotification: async () => rideTap },
    );
    expect(s.calls).not.toContain(active);
    config.resolve({
      status: 200,
      body: { maintenance: false, khrPerUsd: 4000, ios: null, android: null },
    });
    await settle();

    expect(count(s.calls, active)).toBe(1);
    expect(s.calls).not.toContain(details);
    expect(core.stores.notification.getState()).toEqual({
      type: 'ride',
      id: rideId,
      status: 'in_progress',
    });
  });

  it('opens only the pending offer with both tapped ids after a warm refresh', async () => {
    let held: typeof offer | null = offer;
    const { core, open, s } = await bootPush({
      [active]: () => ({ status: 200, body: { ...emptyRides, offer: held } }),
    });
    for (const tap of [
      { ...offerTap, offerId: otherRideId },
      { ...offerTap, rideId: otherRideId },
    ]) {
      open(tap);
      await settle();
      expect(core.stores.notification.getState()).toBeNull();
    }
    // The device clock is fast. The database clock determines whether the offer is still pending.
    const phoneClock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(offer.expiresAt) + 60_000);
    try {
      open(offerTap);
      await settle();
    } finally {
      phoneClock.mockRestore();
    }
    expect(core.stores.notification.getState()).toEqual({
      type: 'offer',
      id: offerId,
    });

    held = null; // the server stops returning expired offers
    open(offerTap);
    await settle();
    expect(core.stores.notification.getState()).toBeNull();
    expect(count(s.calls, active)).toBe(4);
    expect(s.calls).not.toContain(details);
  });

  it('does not open an offer for a rider-only session', async () => {
    const { core, open } = await bootPush({
      'GET /me': () => ({ status: 200, body: { ...me, roles: ['rider'] } }),
      [active]: () => ({ status: 200, body: { ...emptyRides, offer } }),
    });
    open(offerTap);
    await settle();
    expect(core.stores.notification.getState()).toBeNull();
  });

  it('opens a cancelled ride absent from the snapshot using its participant read', async () => {
    const { core, open, s } = await bootPush({
      [active]: () => ({ status: 200, body: emptyRides }),
      [details]: () => ({ status: 200, body: ride('cancelled', 5) }),
    });
    open(rideTap);
    await settle();
    expect(s.calls.slice(-2)).toEqual([active, details]);
    expect(core.stores.notification.getState()).toEqual({
      type: 'ride',
      id: rideId,
      status: 'cancelled',
    });
    expect(core.stores.activeRide.getState().rider).toBeNull();
    expect(core.stores.activeRide.getState().driver).toBeNull();
  });

  it.each<Reply>([
    { status: 404 },
    { status: 200, body: { ...ride('cancelled', 5), id: otherRideId } },
    { status: 200, body: ride('driver_arrived', 3) },
  ])(
    'discards an unavailable, mismatched or older ride response (%j)',
    async reply => {
      const { core, open, s } = await bootPush({
        [active]: () => ({ status: 200, body: emptyRides }),
        [details]: () => reply,
      });
      open(rideTap);
      await settle();
      expect(s.calls.slice(-2)).toEqual([active, details]);
      expect(core.stores.notification.getState()).toBeNull();
    },
  );

  it('ignores malformed taps and refuses a warm open when the refresh fails', async () => {
    const { core, open, s } = await bootPush();
    open(rideTap);
    await settle();
    expect(core.stores.activeRide.getState().driver?.id).toBe(rideId);
    for (const tap of [
      { ...rideTap, seq: 4 },
      { ...rideTap, seq: '1e1' },
      { ...rideTap, rideId: '../me' },
      { ...offerTap, offerId: undefined },
    ]) {
      open(tap);
      await settle();
      expect(core.stores.notification.getState()).toBeNull();
    }
    expect(count(s.calls, active)).toBe(1);

    s.state.offline = true;
    open(rideTap);
    await settle();
    expect(count(s.calls, active)).toBe(2);
    expect(s.calls).not.toContain(details);
    expect(core.stores.activeRide.getState().driver?.id).toBe(rideId);
    expect(core.stores.notification.getState()).toBeNull();
  });

  it('keeps a newer warm tap when an older ride read and the cold message finish later', async () => {
    const oldRide = deferred<Reply>();
    const initial = deferred<unknown>();
    const { core, open, s } = await bootPush(
      {
        [active]: () => ({
          status: 200,
          body: {
            ...emptyRides,
            rider: { ...ride('driver_arrived', 4), id: otherRideId },
          },
        }),
        [details]: () => oldRide.promise,
      },
      { getInitialNotification: () => initial.promise },
    );
    open(rideTap);
    await settle();
    expect(s.calls).toContain(details);
    open({ ...rideTap, rideId: otherRideId });
    await settle();
    const target = { type: 'ride', id: otherRideId, status: 'driver_arrived' };
    expect(core.stores.notification.getState()).toEqual(target);

    oldRide.resolve({ status: 200, body: ride('cancelled', 5) });
    initial.resolve(rideTap);
    await settle();
    expect(count(s.calls, active)).toBe(2);
    expect(core.stores.notification.getState()).toEqual(target);
  });

  it.each(['maintenance', 'update_required', 'sign_out'] as const)(
    'drops an in-flight tap when %s intervenes and does not replay it',
    async gate => {
      const snapshot = deferred<Reply>();
      const { core, open, s } = await bootPush({
        [active]: () => snapshot.promise,
        'POST /auth/otp/verify': () => ({ status: 200, body: pair }),
      });
      open(rideTap);
      await settle();
      expect(s.calls).toContain(active);
      if (gate === 'sign_out') {
        await core.signOut();
        open(rideTap); // a notification still in the tray while signed out
        await core.signIn(me.phone, '000000');
      } else {
        core.stores.appConfig.getState().setGate(
          gate === 'maintenance'
            ? { status: gate }
            : { status: gate, storeUrl: 'https://example.com/lern' },
        );
        open(rideTap);
        core.stores.appConfig.getState().setGate({ status: 'ok' });
      }
      snapshot.resolve({ status: 200, body: { ...emptyRides, driver: ride('driver_arrived', 4) } });
      await settle();
      expect(core.stores.activeRide.getState().driver).toBeNull();
      expect(count(s.calls, active)).toBe(1);
      expect(s.calls).not.toContain(details);
      expect(core.stores.notification.getState()).toBeNull();
    },
  );

  it('removes the native open listener and ignores a late initial notification on app cleanup', async () => {
    const initial = deferred<unknown>();
    const { core, open, push, s } = await bootPush(
      {},
      { getInitialNotification: () => initial.promise },
    );
    core.stopListeningForPush();
    expect(push.unsubscribeOpen).toHaveBeenCalledTimes(1);
    open(rideTap);
    initial.resolve(rideTap);
    await settle();
    expect(s.calls).not.toContain(active);
    expect(core.stores.notification.getState()).toBeNull();
  });

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
    expect(core.stores.notification.getState()).toBeNull();
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

  it('discards a successful PIN check if the screen was locked again during the check', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    await core.enableLock(PIN);
    core.lock();
    const checking = core.unlock(PIN);
    core.lock();
    const result = await checking;
    expect(core.stores.security.getState().locked).toBe(true);
    expect(result.ok).toBe(false);
  });

  it.each(['interrupted', 'different account', 'same account signs in again'])(
    'rejects a PIN result from before %s',
    async reason => {
      const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
      const core = await signedIn(d);
      await core.enableLock(PIN);
      core.lock();
      let release!: () => void;
      const hash = d.pinHasher.hash;
      d.pinHasher.hash = async (salt, code) => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return hash(salt, code);
      };
      const checking = core.unlock(PIN);
      await settle();
      const session = core.stores.session;
      const initialUser = session.getState().me!;
      if (reason === 'interrupted') core.interruptPinCheck();
      else if (reason === 'different account')
        session.getState().signedIn({ ...initialUser, id: 'second' });
      else {
        await core.signOut();
        session.getState().signedIn(initialUser);
      }
      release();
      expect((await checking).ok).toBe(false);
    },
  );

  it('clears pending enrollment when sign-in replaces the account', async () => {
    let user = me;
    const d = deps(
      server(
        routes({
          'GET /me': () => ({ status: 200, body: user }),
          'POST /auth/otp/verify': () => ({ status: 200, body: pair }),
        }),
      ),
      fakeIo(),
      'r'.repeat(43),
    );
    const core = await signedIn(d);
    const set = d.pin.set;
    let finish!: () => void;
    d.pin.set = async hash => {
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      await set(hash);
    };
    const pending = core.enableLock(PIN);
    await settle();
    user = { ...me, id: otherRideId, phone: '+85512345679' };
    const replacement = core.signIn(user.phone, '000000');
    await settle();
    finish();
    await Promise.all([pending, replacement]);
    expect(core.stores.session.getState().me?.id).toBe(user.id);
    expect(d.storedPin()).toBeUndefined();
    expect(core.stores.security.getState().enabled).toBe(false);
  });

  it('serializes enrollment with sign-out while a Keychain write is pending', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    const set = d.pin.set;
    let finish!: () => void;
    d.pin.set = value =>
      new Promise<void>(resolve => {
        finish = () => {
          set(value).then(resolve);
        };
      });
    const enrollment = core.enableLock(PIN);
    await settle();
    await core.signOut();
    finish();
    await enrollment;
    await settle();
    expect(d.storedPin()).toBeUndefined();
    expect(core.stores.security.getState().enabled).toBe(false);
  });

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

  it('keeps an enrolled session locked if its PIN disappears before verification', async () => {
    const d = deps(server(routes()), fakeIo(), 'r'.repeat(43));
    const core = await signedIn(d);
    await core.enableLock(PIN);
    core.lock();
    await d.pin.clear();
    expect(await core.unlock(PIN)).toEqual({ ok: false, waitMs: 0 });
    expect(core.stores.security.getState().locked).toBe(true);
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

describe('driver availability from active rides', () => {
  const profile = routes()['GET /drivers/me']().body;
  const profileReply = (availability: DriverProfile['availability']) => ({
    status: 200,
    body: { ...profile, availability },
  });

  async function connect(extra: Routes = {}) {
    const s = server(
      routes({
        'GET /me/active-ride': () => ({
          status: 200,
          body: { rider: null, driver: null, offer: null },
        }),
        ...extra,
      }),
    );
    const f = fakeIo();
    const core = createCore(deps(s, f, pair.refreshToken));
    await core.boot();
    f.fire('connect');
    await settle();
    return { core, f, calls: s.calls };
  }

  it.each(['pending', 'expired', 'cancelled'])(
    'refreshes on an offer update with status %s',
    async status => {
      const expected = status === 'pending' ? 'reserved' : 'available';
      let availability: DriverProfile['availability'] =
        status === 'pending' ? 'available' : 'reserved';
      const { core, f } = await connect({
        'GET /drivers/me': () => profileReply(availability),
      });
      if (status !== 'pending') {
        f.fire(OFFER_UPDATED_EVENT, offer);
        await settle();
      }

      availability = expected;
      f.fire(OFFER_UPDATED_EVENT, { ...offer, status });
      await settle();

      expect(core.stores.driverMode.getState().availability).toBe(expected);
    },
  );

  it('refreshes when a new pending offer arrives before the old expiry update', async () => {
    let availability: DriverProfile['availability'] = 'available';
    const { core, f } = await connect({
      'GET /drivers/me': () => profileReply(availability),
    });
    // The first pending event arrived after its offer expired on the server.
    const previousOffer = { ...offer, expiresAt: '2020-01-01T00:00:00.000Z' };
    f.fire(OFFER_UPDATED_EVENT, previousOffer);
    await settle();

    availability = 'reserved';
    f.fire(OFFER_UPDATED_EVENT, {
      ...offer,
      id: '00000000-0000-4000-8000-000000000004',
      rideId: otherRideId,
    });
    f.fire(OFFER_UPDATED_EVENT, { ...previousOffer, status: 'expired' });
    await settle();

    expect(core.stores.driverMode.getState().availability).toBe('reserved');
  });

  it.each([
    ['decline', 'available', { ...offer, status: 'declined' }],
    ['accept', 'on_trip', ride('driver_assigned', 2)],
  ] as const)('refreshes after %s', async (action, expected, body) => {
    let availability: DriverProfile['availability'] = 'reserved';
    const { core, f } = await connect({
      'GET /drivers/me': () => profileReply(availability),
      [`POST /offers/${offerId}/${action}`]: () => {
        availability = expected;
        return { status: 200, body };
      },
    });
    f.fire(OFFER_UPDATED_EVENT, offer);
    await settle();

    await core[action](offerId);
    await settle();

    expect(core.stores.driverMode.getState().availability).toBe(expected);
  });

  it('refreshes after accepting an offer while the previous assignment is still cached', async () => {
    let availability: DriverProfile['availability'] = 'on_trip';
    const { core, f } = await connect({
      'GET /drivers/me': () => profileReply(availability),
      'GET /me/active-ride': () => ({
        status: 200,
        body: {
          rider: null,
          driver: { ...ride('driver_assigned', 2), id: otherRideId },
          offer: null,
        },
      }),
      [`POST /offers/${offerId}/accept`]: () => {
        availability = 'on_trip';
        return { status: 200, body: ride('driver_assigned', 2) };
      },
    });
    // The server cancelled the previous ride, and its socket update is delayed.
    availability = 'reserved';
    f.fire(OFFER_UPDATED_EVENT, offer);
    await settle();
    expect(core.stores.driverMode.getState().availability).toBe('reserved');

    await core.accept(offerId);
    await settle();

    expect(core.stores.driverMode.getState().availability).toBe('on_trip');
  });

  it('refreshes on a completed driver ride', async () => {
    let availability: DriverProfile['availability'] = 'on_trip';
    const { core, f } = await connect({
      'GET /drivers/me': () => profileReply(availability),
      'GET /me/active-ride': routes()['GET /me/active-ride'],
    });

    availability = 'offline';
    f.fire(RIDE_UPDATED_EVENT, ride('completed', 5));
    await settle();

    expect(core.stores.driverMode.getState().availability).toBe('offline');
  });

  it('skips profile reads for a duplicate offer and a rider ride update', async () => {
    const { f, calls } = await connect();
    f.fire(OFFER_UPDATED_EVENT, offer);
    await settle();
    const before = calls.length;

    f.fire(OFFER_UPDATED_EVENT, { ...offer });
    f.fire(RIDE_UPDATED_EVENT, { ...ride('searching', 1), id: otherRideId });
    await settle();

    expect(calls.slice(before)).not.toContain('GET /drivers/me');
  });

  it('never reads the driver profile for a rider-only user', async () => {
    const { f, calls } = await connect({
      'GET /me': () => ({ status: 200, body: rider }),
    });
    f.fire(OFFER_UPDATED_EVENT, offer);
    await settle();

    expect(calls).not.toContain('GET /drivers/me');
  });

  it('keeps a newer toggle when an offer-triggered profile read finishes', async () => {
    let reply: Routes[string] = () => profileReply('available');
    const { core, f } = await connect({
      'GET /drivers/me': () => reply(),
      'PUT /drivers/me/availability': () => ({
        status: 200,
        body: { availability: 'offline' },
      }),
    });
    let finish!: (result: Reply) => void;
    const reading = new Promise<Reply>(resolve => {
      finish = resolve;
    });
    reply = () => reading;
    f.fire(OFFER_UPDATED_EVENT, offer);

    await core.setOnline(false);
    finish({
      status: 200,
      body: { ...profile, availability: 'reserved', verification: 'suspended' },
    });
    await settle();

    expect(core.stores.driverMode.getState()).toMatchObject({
      availability: 'offline',
      verification: 'suspended',
    });
  });
});

it('refreshes driver verification and availability on reconnect and ignores an earlier profile response', async () => {
  const profile = routes()['GET /drivers/me']();
  const pending = {
    ...profile,
    body: { ...profile.body, verification: 'pending' },
  };
  let reply = async () => pending;
  const f = fakeIo();
  const core = createCore(
    deps(
      server(routes({ 'GET /drivers/me': () => reply() })),
      f,
      'r'.repeat(43),
    ),
  );
  await core.boot();
  let finish!: () => void;
  const delayed = new Promise<typeof pending>(resolve => {
    finish = () => resolve(pending);
  });
  reply = () => delayed;
  expect(core.stores.driverMode.getState().verification).toBe('pending');
  f.fire('connect');
  await settle();
  reply = async () => ({
    ...profile,
    body: { ...profile.body, availability: 'offline' },
  });
  f.fire('connect');
  await settle();
  expect(core.stores.driverMode.getState().availability).toBe('offline');
  expect(core.stores.driverMode.getState().verification).toBe('verified');
  finish();
  await settle();
  expect(core.stores.driverMode.getState().availability).toBe('offline');
  expect(core.stores.driverMode.getState().verification).toBe('verified');
});

it('keeps a newer driver toggle while applying verification from a delayed profile read', async () => {
  const profile = routes()['GET /drivers/me']();
  let reply = async () => profile;
  const core = createCore(
    deps(
      server(
        routes({
          'GET /drivers/me': () => reply(),
          'PUT /drivers/me/availability': () => ({
            status: 200,
            body: { availability: 'available' },
          }),
        }),
      ),
      fakeIo(),
      'r'.repeat(43),
    ),
  );
  await core.boot();
  let finish!: () => void;
  reply = () =>
    new Promise(resolve => {
      finish = () =>
        resolve({
          ...profile,
          body: { ...profile.body, verification: 'suspended' },
        });
    });
  const refresh = core.refreshAvailability();
  await settle();
  await core.setOnline(true);
  expect(core.stores.driverMode.getState().verification).toBe('verified');
  finish();
  await refresh;
  expect(core.stores.driverMode.getState().availability).toBe('available');
  expect(core.stores.driverMode.getState().verification).toBe('suspended');
});

it('applies a profile availability refresh across a location permission update', async () => {
  const profile = routes()['GET /drivers/me']();
  let reply = async () => profile;
  const core = createCore(
    deps(
      server(routes({ 'GET /drivers/me': () => reply() })),
      fakeIo(),
      'r'.repeat(43),
    ),
  );
  await core.boot();
  let finish!: () => void;
  reply = () =>
    new Promise(resolve => {
      finish = () =>
        resolve({
          ...profile,
          body: { ...profile.body, availability: 'offline' },
        });
    });
  const refresh = core.refreshAvailability();
  await settle();
  core.stores.driverMode.setState({ locationPermission: 'foreground' });
  finish();
  await refresh;
  expect(core.stores.driverMode.getState()).toMatchObject({
    availability: 'offline',
    locationPermission: 'foreground',
  });
});

it('ignores a superseded profile read even when the latest read is offline', async () => {
  const profile = routes()['GET /drivers/me']();
  let reply = async () => profile;
  const core = createCore(
    deps(
      server(routes({ 'GET /drivers/me': () => reply() })),
      fakeIo(),
      'r'.repeat(43),
    ),
  );
  await core.boot();
  let finish!: () => void;
  reply = () =>
    new Promise(resolve => {
      finish = () =>
        resolve({
          ...profile,
          body: { ...profile.body, availability: 'offline' },
        });
    });
  const first = core.refreshAvailability();
  await settle();
  reply = async () => {
    throw new Error('network unavailable');
  };
  await core.refreshAvailability();
  finish();
  await first;
  expect(core.stores.driverMode.getState().availability).toBe('on_trip');
});
