import { DRIVER_CONNECTIVITY_EVENT } from '@lern/contracts';
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
