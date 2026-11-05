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
