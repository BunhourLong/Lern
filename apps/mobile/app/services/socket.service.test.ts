import {
  DRIVER_CONNECTIVITY_EVENT,
  DRIVER_LOCATION_EVENT,
  DRIVER_POSITION_EVENT,
  OFFER_UPDATED_EVENT,
  RIDE_UPDATED_EVENT,
} from '@lern/contracts';
import type { io } from 'socket.io-client';
import type { Refreshed } from './api.service';
import { connectSocket, type SocketHandlers } from './socket.service';

const rideId = '00000000-0000-4000-8000-000000000001';
const ride = {
  id: rideId,
  status: 'driver_assigned',
  version: 2,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 4000, currency: 'KHR' },
};
const point = {
  lat: 11.55,
  lng: 104.92,
  recordedAt: '2026-11-01T10:00:00.000Z',
};

// A stand-in for socket.io-client's io(): records options, lets the test fire server events and set acks
function fakeIo() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const state = {
    options: undefined as Record<string, unknown> | undefined,
    connects: 0,
    ack: undefined as unknown,
    emitted: [] as unknown[],
  };
  const socket = {
    connected: false,
    on: (event: string, h: (...args: unknown[]) => unknown) =>
      handlers.set(event, h),
    connect: () => {
      state.connects++;
    },
    disconnect: jest.fn(),
    timeout: () => ({
      emitWithAck: async (event: string, payload: unknown) => {
        state.emitted.push([event, payload]);
        if (state.ack instanceof Error) throw state.ack;
        return state.ack;
      },
    }),
  };
  const ioFn = jest.fn((_url: string, options: Record<string, unknown>) => {
    state.options = options;
    return socket;
  });
  const fire = (event: string, ...args: unknown[]) =>
    handlers.get(event)!(...args);
  return { io: ioFn as unknown as typeof io, socket, state, fire };
}
const handlers = (): jest.Mocked<SocketHandlers> => ({
  onRide: jest.fn(),
  onOffer: jest.fn(),
  onPosition: jest.fn(),
  onConnectivity: jest.fn(),
  onConnect: jest.fn(),
  onRejected: jest.fn(),
});
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

it('connects over websocket only and sends the current access token on every (re)connect', () => {
  const f = fakeIo();
  let token = 'access-1';
  connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => token,
    refresh: async () => 'ok' as const,
    handlers: handlers(),
  });
  expect(f.state.options).toMatchObject({ transports: ['websocket'] });
  const auth = f.state.options!.auth as (cb: (data: object) => void) => void;
  const sent: object[] = [];
  auth(d => sent.push(d));
  token = 'access-2';
  auth(d => sent.push(d));
  expect(sent).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
});

it('hands every server event to its handler only after the contract accepts it', () => {
  const f = fakeIo();
  const h = handlers();
  connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => 't',
    refresh: async () => 'ok' as const,
    handlers: h,
  });
  f.fire('connect');
  f.fire(RIDE_UPDATED_EVENT, ride);
  f.fire(RIDE_UPDATED_EVENT, { ...ride, version: 'two' });
  f.fire(DRIVER_POSITION_EVENT, { ...point, rideId });
  f.fire(DRIVER_CONNECTIVITY_EVENT, {
    rideId,
    stale: true,
    lastSeenAt: point.recordedAt,
  });
  f.fire(OFFER_UPDATED_EVENT, { id: rideId });
  expect(h.onConnect).toHaveBeenCalledTimes(1);
  expect(h.onRide).toHaveBeenCalledWith(ride);
  expect(h.onPosition).toHaveBeenCalledWith({ ...point, rideId });
  expect(h.onConnectivity).toHaveBeenCalledWith({
    rideId,
    stale: true,
    lastSeenAt: point.recordedAt,
  });
  expect(h.onOffer).not.toHaveBeenCalled();
  expect(h.onRejected.mock.calls.map(([event]) => event)).toEqual([
    RIDE_UPDATED_EVENT,
    OFFER_UPDATED_EVENT,
  ]);
});

it.each([
  [
    'refused at the handshake',
    (f: ReturnType<typeof fakeIo>) =>
      f.fire('connect_error', new Error('Unauthorized')),
  ],
  [
    'dropped by the server when the token expired',
    (f: ReturnType<typeof fakeIo>) =>
      f.fire('disconnect', 'io server disconnect'),
  ],
])(
  'refreshes the session and connects again when %s, but not when the refresh fails',
  async (_, kick) => {
    const ok = fakeIo();
    connectSocket({
      url: 'http://api.test',
      io: ok.io,
      token: () => 't',
      refresh: async () => 'ok' as const,
      handlers: handlers(),
    });
    kick(ok);
    await flush();
    expect(ok.state.connects).toBe(1);

    const failed = fakeIo();
    connectSocket({
      url: 'http://api.test',
      io: failed.io,
      token: () => 't',
      refresh: async () => 'refused' as const,
      handlers: handlers(),
    });
    kick(failed);
    await flush();
    expect(failed.state.connects).toBe(0);
  },
);

it('leaves a network failure to socket.io’s own reconnection', async () => {
  const f = fakeIo();
  const refresh = jest.fn(async () => 'ok' as const);
  connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => 't',
    refresh,
    handlers: handlers(),
  });
  f.fire('connect_error', new Error('websocket error'));
  f.fire('disconnect', 'transport close');
  await flush();
  expect([refresh.mock.calls.length, f.state.connects]).toEqual([0, 0]);
});

it('reports a position over the socket, false when it is down or the server refused or did not ack', async () => {
  const f = fakeIo();
  const s = connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => 't',
    refresh: async () => 'ok' as const,
    handlers: handlers(),
  });
  expect(await s.sendLocation(point)).toBe(false); // not connected
  f.socket.connected = true;
  f.state.ack = { dropped: 0 };
  expect(await s.sendLocation(point)).toBe(true);
  expect(f.state.emitted).toEqual([[DRIVER_LOCATION_EVENT, point]]);
  f.state.ack = { error: 'FORBIDDEN' };
  expect(await s.sendLocation(point)).toBe(false);
  f.state.ack = new Error('operation has timed out');
  expect(await s.sendLocation(point)).toBe(false);
});

it('re-authenticates once per connection attempt: a second refusal right after does not loop', async () => {
  const f = fakeIo();
  const refresh = jest.fn(async () => 'ok' as const);
  connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => 't',
    refresh,
    handlers: handlers(),
    sleep: async () => undefined,
  });
  f.fire('connect_error', new Error('Unauthorized'));
  await flush();
  f.fire('connect_error', new Error('Unauthorized'));
  await flush();
  expect([refresh.mock.calls.length, f.state.connects]).toEqual([1, 1]);
  f.fire('connect'); // a good connection resets it
  f.fire('disconnect', 'io server disconnect');
  await flush();
  expect([refresh.mock.calls.length, f.state.connects]).toEqual([2, 2]);
});

it('keeps trying to re-authenticate while the refresh is only offline, and stops when refused', async () => {
  const f = fakeIo();
  const answers = ['offline', 'offline', 'ok'] as const;
  const refresh = jest.fn(
    async (): Promise<Refreshed> => answers[refresh.mock.calls.length - 1],
  );
  const sleep = jest.fn(async () => undefined);
  connectSocket({
    url: 'http://api.test',
    io: f.io,
    token: () => 't',
    refresh,
    handlers: handlers(),
    sleep,
  });
  f.fire('disconnect', 'io server disconnect');
  for (let i = 0; i < 5; i++) await flush();
  expect([
    refresh.mock.calls.length,
    f.state.connects,
    sleep.mock.calls.length,
  ]).toEqual([3, 1, 2]);
});
