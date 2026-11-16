import type { LocationPoint, Ride } from '@lern/contracts';
import { ApiError } from './api.service';
import {
  createOfflineQueue,
  type OfflineQueueDeps,
} from './offline-queue.service';
import type { KeyValueStore } from './storage.service';

const rideId = '00000000-0000-4000-8000-000000000001';
const ride = (status: Ride['status'], version: number) =>
  ({ id: rideId, status, version } as Ride);
const point = (s: number): LocationPoint => ({
  lat: 11.55,
  lng: 104.92,
  recordedAt: new Date(Date.UTC(2026, 10, 1, 10, 0, 0, s)).toISOString(),
});

function memory(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    get: k => m.get(k),
    set: (k, v) => {
      m.set(k, v);
    },
    remove: k => {
      m.delete(k);
    },
  };
}
// An API that answers each call from a script; a missing answer means offline
function scripted(...answers: (Ride | ApiError | { dropped: number })[]) {
  const steps: [string, string, string][] = [];
  const batches: LocationPoint[][] = [];
  const next = async () => {
    const a = answers.shift() ?? new ApiError(0, null);
    if (a instanceof ApiError) throw a;
    return a;
  };
  const api: OfflineQueueDeps['api'] = {
    step: jest.fn(async (id: string, action: string, key: string) => {
      steps.push([id, action, key]);
      return (await next()) as Ride;
    }) as OfflineQueueDeps['api']['step'],
    recordLocations: jest.fn(async (points: LocationPoint[]) => {
      batches.push(points);
      return (await next()) as { dropped: number };
    }),
  };
  return { api, steps, batches };
}
const queue = (store: KeyValueStore, api: OfflineQueueDeps['api']) => {
  const onStepDone = jest.fn();
  const onRejected = jest.fn();
  return {
    q: createOfflineQueue({ store, api, onStepDone, onRejected }),
    onStepDone,
    onRejected,
  };
};

it('sends a queued step with the key it got when queued, and forgets it once the server answered', async () => {
  const s = scripted(ride('driver_arrived', 3));
  const { q, onStepDone } = queue(memory(), s.api);
  const { key } = q.enqueueStep(rideId, 'arrive');
  await q.flush();
  expect(s.steps).toEqual([[rideId, 'arrive', key]]);
  expect(onStepDone).toHaveBeenCalledWith(ride('driver_arrived', 3));
  expect(q.pending()).toEqual({ steps: [], points: 0 });
});

it('keeps a step while offline and resends it with the same key, also after an app restart', async () => {
  const store = memory();
  const offline = scripted();
  const first = queue(store, offline.api);
  first.q.enqueueStep(rideId, 'arrive');
  await first.q.flush();
  expect(first.q.pending().steps).toHaveLength(1);

  const online = scripted(ride('driver_arrived', 3));
  const restarted = queue(store, online.api); // a new process reading the same MMKV
  await restarted.q.flush();
  expect(online.steps[0][2]).toBe(offline.steps[0][2]);
  expect(restarted.q.pending().steps).toEqual([]);
});

it('drops a step the server refused and hands the refusal (with its ride snapshot) on', async () => {
  const refusal = new ApiError(409, {
    code: 'INVALID_TRANSITION',
    ride: ride('cancelled', 4),
  });
  const s = scripted(refusal, ride('in_progress', 4));
  const { q, onRejected } = queue(memory(), s.api);
  q.enqueueStep(rideId, 'arrive');
  q.enqueueStep(rideId, 'start');
  await q.flush();
  expect(onRejected).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'arrive' }),
    refusal,
  );
  expect(s.steps.map(([, action]) => action)).toEqual(['arrive', 'start']);
  expect(q.pending().steps).toEqual([]);
});

it.each([
  ['offline', new ApiError(0, null)],
  ['a server error', new ApiError(503, null)],
  ['rate limited', new ApiError(429, null)],
  [
    'the same key still in progress',
    new ApiError(409, {
      message: 'A request with this Idempotency-Key is in progress',
    }),
  ],
])(
  'stops at a step that hit %s, keeping it and every later one in order',
  async (_, err) => {
    const s = scripted(err);
    const { q, onRejected } = queue(memory(), s.api);
    q.enqueueStep(rideId, 'arrive');
    q.enqueueStep(rideId, 'start');
    q.enqueuePoint(point(1));
    await q.flush();
    expect(s.steps.map(([, action]) => action)).toEqual(['arrive']);
    expect(s.batches).toEqual([]);
    expect(q.pending()).toMatchObject({
      steps: [{ action: 'arrive' }, { action: 'start' }],
      points: 1,
    });
    expect(onRejected).not.toHaveBeenCalled();
  },
);

it('sends points oldest first in batches of 100, keeping the newest 2000 while offline', async () => {
  const s = scripted({ dropped: 0 }, { dropped: 0 });
  const { q } = queue(memory(), s.api);
  for (let i = 0; i < 2100; i++) q.enqueuePoint(point(i));
  expect(q.pending().points).toBe(2000);
  await q.flush(); // two answers, then offline
  expect(s.batches.map(b => b.length)).toEqual([100, 100, 100]);
  expect(s.batches[0][0]).toEqual(point(100)); // the 100 oldest were dropped at the cap
  expect(q.pending().points).toBe(1800);
});

it('drops a batch of points the server will never take (e.g. 403 after a suspension)', async () => {
  const s = scripted(new ApiError(403, null), { dropped: 0 });
  const { q } = queue(memory(), s.api);
  for (let i = 0; i < 150; i++) q.enqueuePoint(point(i));
  await q.flush();
  expect(s.batches.map(b => b.length)).toEqual([100, 50]);
  expect(q.pending().points).toBe(0);
});

it('sends each step once when two flushes start together', async () => {
  const s = scripted(ride('driver_arrived', 3));
  const { q } = queue(memory(), s.api);
  q.enqueueStep(rideId, 'arrive');
  await Promise.all([q.flush(), q.flush()]);
  expect(s.steps).toHaveLength(1);
});

it('starts empty when what it finds in storage is not a queue', async () => {
  const store = memory();
  store.set('offline-queue.v1', '{not json');
  const { q } = queue(store, scripted().api);
  expect(q.pending()).toEqual({ steps: [], points: 0 });
});

it('forgets every queued step and point on clear (sign-out)', () => {
  const { q } = queue(memory(), scripted().api);
  q.enqueueStep(rideId, 'arrive');
  q.enqueuePoint(point(1));
  q.clear();
  expect(q.pending()).toEqual({ steps: [], points: 0 });
});

it('sends a step queued while a points upload is in flight, before the remaining points', async () => {
  let release!: () => void;
  const order: string[] = [];
  const api: OfflineQueueDeps['api'] = {
    step: jest.fn(async () => {
      order.push('step');
      return ride('completed', 5);
    }) as OfflineQueueDeps['api']['step'],
    recordLocations: jest.fn(async (points: LocationPoint[]) => {
      order.push(`points ${points.length}`);
      if (order.length === 1)
        await new Promise<void>(resolve => (release = resolve));
      return { dropped: 0 };
    }),
  };
  const { q } = queue(memory(), api);
  for (let i = 0; i < 150; i++) q.enqueuePoint(point(i));
  const flushing = q.flush();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  q.enqueueStep(rideId, 'complete');
  expect(q.flush()).toBe(flushing); // joins the running flush
  release();
  await flushing;
  expect(order).toEqual(['points 100', 'step', 'points 50']);
  expect(q.pending()).toEqual({ steps: [], points: 0 });
});

it('reports nothing for a step answered after the queue was cleared (signed out meanwhile)', async () => {
  let answer!: (r: Ride) => void;
  const api: OfflineQueueDeps['api'] = {
    step: jest.fn(
      () => new Promise<Ride>(resolve => (answer = resolve)),
    ) as OfflineQueueDeps['api']['step'],
    recordLocations: jest.fn(),
  };
  const { q, onStepDone } = queue(memory(), api);
  q.enqueueStep(rideId, 'complete');
  const flushing = q.flush();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  q.clear();
  answer(ride('completed', 5));
  await flushing;
  expect(onStepDone).not.toHaveBeenCalled();
});
