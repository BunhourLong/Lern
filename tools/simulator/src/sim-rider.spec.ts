import { DRIVER_CONNECTIVITY_EVENT, RIDE_UPDATED_EVENT, type Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from './api.client';
import { SimRider } from './sim-rider';

it('keeps the newest driver:connectivity per ride, and counts older and malformed ones', () => {
  const handlers = new Map<string, (raw: unknown) => void>();
  const socket = { on: (event: string, h: (raw: unknown) => void) => handlers.set(event, h) } as unknown as Socket;
  const api = { book: () => new Promise(() => undefined) } as unknown as ApiClient; // the ride never comes back
  const rider = new SimRider({ userId: 'r', token: 't' }, socket, { api, pauseMs: 1, rand: () => 0.5, log: () => undefined });
  const push = handlers.get(DRIVER_CONNECTIVITY_EVENT)!;
  const rideId = '00000000-0000-4000-8000-000000000001';
  const silent = { rideId, stale: true, lastSeenAt: '2026-10-31T10:00:30.000Z' };
  const back = { rideId, stale: false, lastSeenAt: '2026-10-31T10:01:00.000Z' };

  push(silent);
  push(back);
  push(silent); // delivered late: older than what the rider holds
  push({ rideId, stale: 'yes' });

  expect(rider.connectivity).toEqual([silent, back]);
  expect([rider.stale, rider.rejected]).toEqual([1, 1]);
});

describe('reconnect recovery', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const ride = (version: number, status = 'in_progress') => ({ id, version, status }) as Ride;
  const setup = (api: Record<string, unknown>) => {
    const handlers = new Map<string, (raw: unknown) => void>();
    const socket = { on: (event: string, h: (raw: unknown) => void) => handlers.set(event, h) } as unknown as Socket;
    const log = jest.fn();
    const rider = new SimRider({ userId: 'r', token: 't' }, socket, {
      api: api as unknown as ApiClient,
      pauseMs: 1,
      rand: () => 0.5,
      log,
    });
    return { rider, log, connect: () => handlers.get('connect')!(undefined), push: handlers.get(RIDE_UPDATED_EVENT)! };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('completes a ride whose terminal event was missed while the socket was down', async () => {
    const book = jest.fn().mockResolvedValueOnce(ride(1, 'searching')).mockReturnValue(new Promise(() => undefined));
    const { rider, connect } = setup({
      book,
      activeRides: () => Promise.resolve({ rider: null, driver: null }),
      ride: () => Promise.resolve(ride(5, 'completed')),
    });
    await flush();
    connect();
    await flush();
    expect([rider.completed, rider.recovered, rider.reconnects]).toEqual([1, 1, 1]);
    expect(book).toHaveBeenCalledTimes(2);
  });

  it('applies a newer snapshot once, ignoring older events and repeated snapshots', async () => {
    const { rider, connect, push } = setup({
      book: jest.fn().mockResolvedValueOnce(ride(1, 'searching')).mockReturnValue(new Promise(() => undefined)),
      activeRides: () => Promise.resolve({ rider: ride(4), driver: null }),
    });
    await flush();
    push(ride(2));
    connect();
    await flush();
    push(ride(3));
    connect();
    await flush();
    expect(rider.updates.map((r) => r.version)).toEqual([2, 4]);
    expect([rider.recovered, rider.stale]).toEqual([1, 1]);
  });

  it('lets an event delivered during the fetch win over an older snapshot', async () => {
    let answer!: (v: unknown) => void;
    const { rider, connect, push } = setup({
      book: jest.fn().mockResolvedValueOnce(ride(1, 'searching')).mockReturnValue(new Promise(() => undefined)),
      activeRides: () => new Promise((resolve) => (answer = resolve)),
    });
    await flush();
    connect();
    push(ride(4));
    answer({ rider: ride(3), driver: null });
    await flush();
    expect(rider.updates.map((r) => r.version)).toEqual([4]);
    expect([rider.recovered, rider.stale]).toEqual([0, 0]);
  });

  it('logs a failed fetch and recovers on the next connect', async () => {
    const activeRides = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rider: ride(4), driver: null });
    const { rider, log, connect } = setup({ book: jest.fn().mockResolvedValueOnce(ride(1, 'searching')).mockReturnValue(new Promise(() => undefined)), activeRides });
    await flush();
    connect();
    await flush();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(rider.recovered).toBe(0);
    connect();
    await flush();
    expect(rider.recovered).toBe(1);
  });
});

describe('late and out-of-order ride:updated packets', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const ride = (version: number, status = 'in_progress') => ({ id, version, status }) as Ride;
  const setup = (jitterMs?: number) => {
    const handlers = new Map<string, (raw: unknown) => void>();
    const socket = { on: (event: string, h: (raw: unknown) => void) => handlers.set(event, h) } as unknown as Socket;
    const rider = new SimRider({ userId: 'r', token: 't' }, socket, {
      api: { book: () => new Promise(() => undefined) } as unknown as ApiClient,
      pauseMs: 1,
      jitterMs,
      rand: () => 0.5,
      log: () => undefined,
    });
    return { rider, push: handlers.get(RIDE_UPDATED_EVENT)! };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
  const until = async (done: () => boolean) => {
    for (const end = Date.now() + 2000; !done(); await new Promise((resolve) => setTimeout(resolve, 2))) {
      if (Date.now() > end) throw new Error('condition not met within 2 s');
    }
  };

  it('keeps every snapshot in arrival order but only the newest version in updates', async () => {
    const { rider, push } = setup();
    push(ride(2)); // the chaos delivered the higher version first
    push(ride(1));
    await flush();
    const received = (rider as unknown as { received?: Ride[] }).received;
    expect(received?.map((r) => r.version)).toEqual([2, 1]); // arrival order, both kept
    expect(rider.updates.map((r) => r.version)).toEqual([2]); // the filter holds only the newer one
    expect(rider.stale).toBe(1);
  });

  it('holds each packet for a random delay, then applies both', async () => {
    const delay = jest.spyOn(global.Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.05);
    const { rider, push } = setup(20);
    try {
      push(ride(3)); // held for 18 ms: the later version overtakes it
      push(ride(2)); // held for 1 ms
      expect((rider as unknown as { received?: Ride[] }).received).toEqual([]); // timers run between ticks, not sync statements
      await until(() => rider.received.length >= 2);
      expect(rider.received.map((r) => r.version)).toEqual([2, 3]); // arrival order
      expect(rider.updates.map((r) => r.version)).toEqual([2, 3]); // 2 is not stale when the newer one was still in flight
    } finally {
      delay.mockRestore();
    }
  });

  it('does not deliver a held packet after stop', async () => {
    const delay = jest.spyOn(global.Math, 'random').mockReturnValue(0.999999);
    const book = jest.fn().mockResolvedValueOnce(ride(1, 'searching')).mockReturnValue(new Promise(() => undefined));
    const handlers = new Map<string, (raw: unknown) => void>();
    const socket = {
      on: (event: string, h: (raw: unknown) => void) => handlers.set(event, h),
      disconnect: () => undefined,
    } as unknown as Socket;
    const rider = new SimRider({ userId: 'r', token: 't' }, socket, {
      api: { book } as unknown as ApiClient,
      pauseMs: 60_000,
      jitterMs: 5,
      rand: () => 0.5,
      log: () => undefined,
    });
    try {
      await until(() => book.mock.calls.length > 0); // the loop is running
      const push = handlers.get(RIDE_UPDATED_EVENT)!;
      push(ride(2)); // held for a tick, then cleared by stop
      expect(rider.received).toEqual([]);
      await rider.stop();
      push(ride(1)); // lands while stopping: no timer may outlive the clear
      await flush();
      expect(rider.received).toEqual([]);
      expect(rider.updates).toEqual([]);
    } finally {
      delay.mockRestore();
    }
  });
});
