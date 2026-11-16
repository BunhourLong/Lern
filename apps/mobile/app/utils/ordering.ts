import type { Offer, Ride } from '@lern/contracts';

// What a client keeps when events arrive late, twice or out of order (at-least-once from any API instance).

const ENDED = new Set<Ride['status']>([
  'completed',
  'cancelled',
  'no_driver_found',
]);

// Invariant 8: seq = version. Another ride replaces the held one only after the held one ended, so a late event of
// an old ride never hides the current one (one active ride per side).
export function keepRide(held: Ride | null, incoming: Ride): Ride {
  if (!held) return incoming;
  if (held.id !== incoming.id) return ENDED.has(held.status) ? incoming : held;
  return incoming.version > held.version ? incoming : held;
}

// Offers carry no seq: pending is first and every other status is final, so a final beats pending and the first
// final stays. A new pending offer means the held one ended (its event may be lost); a final of an offer no longer
// held is late.
export function keepOffer(held: Offer | null, incoming: Offer): Offer {
  if (!held) return incoming;
  if (held.id !== incoming.id)
    return incoming.status === 'pending' || held.status !== 'pending'
      ? incoming
      : held;
  return held.status === 'pending' ? incoming : held;
}

// For values ordered by a server or device instant (positions by recordedAt, connectivity by lastSeenAt)
export function keepNewer<T>(
  held: T | undefined,
  incoming: T,
  at: (x: T) => string,
): T {
  return !held || Date.parse(at(incoming)) > Date.parse(at(held))
    ? incoming
    : held;
}
