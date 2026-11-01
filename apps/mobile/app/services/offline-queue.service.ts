import type { LocationPoint, Ride } from '@lern/contracts';
import { uuid } from '../utils/uuid';
import { type Api, ApiError } from './api.service';
import type { KeyValueStore } from './storage.service';

// What may wait for the network (decided 2026-11-01): location points, and the driver's trip steps so a dead zone
// at pickup or dropoff doesn't strand them. Book, accept, decline and cancel are never queued: the user must see
// their result now (an offer lasts 15 s).
export type QueuedStep = {
  rideId: string;
  action: 'arrive' | 'start' | 'complete';
  key: string;
};
type Stored = { steps: QueuedStep[]; points: LocationPoint[] };

export type OfflineQueueDeps = {
  store: KeyValueStore;
  api: Pick<Api, 'step' | 'recordLocations'>;
  onStepDone(ride: Ride): void;
  onRejected(step: QueuedStep, err: ApiError): void; // a 409's body carries the ride snapshot to reconcile with
};

const KEY = 'offline-queue.v1';
const MAX_POINTS = 2000; // ~2 h at one point per 4 s; older ones are dropped first
const BATCH = 100; // the server's per-request maximum

// Worth sending again later: no answer, overloaded, or the same key still being processed. Anything else is final.
function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.status === 409)
    return (
      (err.body as { code?: string } | null)?.code !== 'INVALID_TRANSITION'
    );
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

export function createOfflineQueue({
  store,
  api,
  onStepDone,
  onRejected,
}: OfflineQueueDeps) {
  // Every change is written through: an app killed mid-flush resends the head with the same key, so the server
  // replays its first answer instead of acting twice (invariant 10)
  const read = (): Stored => {
    try {
      const parsed = JSON.parse(store.get(KEY) ?? '') as Stored;
      return Array.isArray(parsed.steps) && Array.isArray(parsed.points)
        ? parsed
        : { steps: [], points: [] };
    } catch {
      return { steps: [], points: [] };
    }
  };
  const write = (change: (q: Stored) => void) => {
    const q = read();
    change(q);
    store.set(KEY, JSON.stringify(q));
  };

  let flushing: Promise<void> | undefined;
  // Bumped by clear(): a request answered after sign-out reports nothing and changes nothing
  let generation = 0;
  async function drain(): Promise<void> {
    const gen = generation;
    // Steps first and strictly in order (arrive before start before complete), checked again after every point
    // batch so a step queued during a long points upload goes next
    for (;;) {
      const step = read().steps[0];
      if (step) {
        let ride: Ride | undefined;
        try {
          ride = await api.step(step.rideId, step.action, step.key);
        } catch (err) {
          if (gen !== generation || retryable(err)) return;
          onRejected(step, err as ApiError);
        }
        if (gen !== generation) return;
        write(q => {
          q.steps.shift();
        });
        if (ride) onStepDone(ride);
        continue;
      }
      const batch = read().points.slice(0, BATCH);
      if (batch.length === 0) return;
      try {
        await api.recordLocations(batch);
      } catch (err) {
        // refused for good (e.g. 403 after a suspension): these points can never be stored
        if (retryable(err)) return;
      }
      if (gen !== generation) return;
      write(q => {
        q.points.splice(0, batch.length);
      });
    }
  }

  return {
    enqueueStep(rideId: string, action: QueuedStep['action']): QueuedStep {
      const step = { rideId, action, key: uuid() };
      write(q => {
        q.steps.push(step);
      });
      return step;
    },
    enqueuePoint(point: LocationPoint): void {
      write(q => {
        q.points.push(point);
        q.points.splice(0, Math.max(0, q.points.length - MAX_POINTS));
      });
    },
    // Sign-out: queued steps and points belong to the user who queued them
    clear: () => {
      generation++;
      store.remove(KEY);
    },
    pending: () => {
      const { steps, points } = read();
      return { steps, points: points.length };
    },
    // Single-flight; resolves when the queue is empty or the network gave up again
    flush(): Promise<void> {
      flushing ??= drain().finally(() => (flushing = undefined));
      return flushing;
    },
  };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
