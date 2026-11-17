import {
  type DriverAvailability,
  type DriverAvailabilityAction,
  driverTransition,
  type RideAction,
  type RideActor,
  type RideStatus,
  rideTransition,
} from '@lern/contracts';

// A pure model of the ride, offer and availability machines plus the matching rule (PLAN.md §2.4, §4), for the
// model-based test: it says what the API must answer and what the database must hold after any command sequence.

export const RIDERS = 3;
export const DRIVERS = 3; // driver i stands (i + 1) × 300 m from the one pickup spot, so lower i is nearer

type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
type Ride = { token: string; rider: number; status: RideStatus; driver: number | null; order: number };
// lapsed: past expires_at by the DB clock while its timer hasn't fired yet
type Offer = { ride: string; driver: number; status: OfferStatus; lapsed: boolean };
// order: created_at rank; the deadline command moves a ride before every unexpired one (negative order)
export type Model = { drivers: DriverAvailability[]; rides: Ride[]; offers: Offer[]; clock: number };

export const initialModel = (): Model => ({ drivers: Array<DriverAvailability>(DRIVERS).fill('available'), rides: [], offers: [], clock: 0 });

type Step = 'arrive' | 'start' | 'complete';
// As generated: rides and offers by any number (taken modulo what exists when the command runs)
export type Raw =
  | { kind: 'book'; rider: number }
  | { kind: 'sync' | 'deadline'; ride: number }
  | { kind: 'sweep' | 'reconcile' }
  | { kind: 'accept' | 'decline'; offer: number; by: 'own' | number }
  | { kind: 'timer' | 'lapse'; offer: number }
  | { kind: 'cancel'; ride: number; by: 'rider' | 'assigned' | number }
  | { kind: 'step'; ride: number; action: Step; by: 'assigned' | number }
  | { kind: 'online'; driver: number; online: boolean }
  | { kind: 'pair'; a: Raw; b: Raw };

// Resolved: rides by the token of the command that booked them, offers by ride and driver, actors by index
export type OfferRef = { ride: string; driver: number };
export type Command =
  | { kind: 'book'; rider: number; token: string }
  | { kind: 'sync' | 'deadline'; ride: string }
  | { kind: 'sweep' | 'reconcile' }
  | { kind: 'accept' | 'decline'; offer: OfferRef; by: number }
  | { kind: 'timer' | 'lapse'; offer: OfferRef }
  | { kind: 'cancel'; ride: string; by: { rider: number } | { driver: number } }
  | { kind: 'step'; ride: string; action: Step; by: number }
  | { kind: 'online'; driver: number; online: boolean }
  | { kind: 'pair'; a: Command; b: Command };

// An HTTP status, 'ok' for a job that ran, the reconciler's counts, or both answers of a pair (a first)
export type Outcome = number | string | Record<string, number> | Outcome[];

const DRIVER_ACTIVE: RideStatus[] = ['driver_assigned', 'driver_arrived', 'in_progress'];
const RIDER_ACTIVE: RideStatus[] = ['searching', ...DRIVER_ACTIVE];

// undefined when the command has nothing to act on yet (no ride or offer). Offer and step commands prefer a
// pending offer / an active trip when there is one, or trips would rarely get past the first step.
export function resolve(m: Model, raw: Raw, token: string): Command | undefined {
  const pick = <T>(xs: T[], i: number): T | undefined => xs[i % xs.length];
  const offer = (i: number) => pick(m.offers.filter((o) => o.status === 'pending'), i) ?? pick(m.offers, i);
  switch (raw.kind) {
    case 'book':
      return { ...raw, token };
    case 'sweep':
    case 'reconcile':
    case 'online':
      return raw;
    case 'sync':
    case 'deadline': {
      const r = pick(m.rides, raw.ride);
      return r && { kind: raw.kind, ride: r.token };
    }
    case 'accept':
    case 'decline': {
      const o = offer(raw.offer);
      return o && { kind: raw.kind, offer: { ride: o.ride, driver: o.driver }, by: raw.by === 'own' ? o.driver : raw.by };
    }
    case 'timer':
    case 'lapse': {
      const o = offer(raw.offer);
      return o && { kind: raw.kind, offer: { ride: o.ride, driver: o.driver } };
    }
    case 'cancel': {
      const r = pick(m.rides, raw.ride);
      if (!r) return undefined;
      return { kind: 'cancel', ride: r.token, by: raw.by === 'rider' ? { rider: r.rider } : { driver: driverOf(r, raw.by) } };
    }
    case 'step': {
      const r = pick(m.rides.filter((x) => DRIVER_ACTIVE.includes(x.status)), raw.ride) ?? pick(m.rides, raw.ride);
      return r && { kind: 'step', ride: r.token, action: raw.action, by: driverOf(r, raw.by) };
    }
    case 'pair': {
      const a = resolve(m, raw.a, `${token}a`);
      const b = resolve(m, raw.b, `${token}b`);
      return a && b && { kind: 'pair', a, b };
    }
  }
}

// 'assigned' falls back to driver 0 while the ride has none, which then gets the non-participant answer
const driverOf = (r: Ride, by: 'assigned' | number) => (by === 'assigned' ? (r.driver ?? 0) : by);

const byOrder = (a: Ride, b: Ride) => a.order - b.order;
const rideOf = (m: Model, token: string) => m.rides.find((r) => r.token === token)!;
const offerOf = (m: Model, ref: OfferRef) => m.offers.find((o) => o.ride === ref.ride && o.driver === ref.driver)!;
const pendingOf = (m: Model, token: string) => m.offers.find((o) => o.ride === token && o.status === 'pending');

// Guarded moves, as the API's UPDATEs: nothing changes unless the row is in a from-state
function moveDriver(m: Model, driver: number, action: DriverAvailabilityAction): boolean {
  const t = driverTransition(action);
  if (m.drivers[driver] !== t.from) return false;
  m.drivers[driver] = t.to;
  return true;
}
function moveRide(r: Ride, action: RideAction, actor: RideActor): boolean {
  const t = rideTransition(action, actor)!;
  if (!t.from.includes(r.status)) return false;
  r.status = t.to;
  return true;
}

// seen: the drivers available when sync read its candidates, before it locked one (a single-step sync reads them now)
function sync(m: Model, token: string, seen?: number[]): void {
  const r = rideOf(m, token);
  const pending = pendingOf(m, token);
  if (r.status !== 'searching') {
    if (pending) {
      pending.status = 'cancelled';
      moveDriver(m, pending.driver, 'release');
    }
    return;
  }
  if (pending) return;
  if (r.order < 0) {
    moveRide(r, 'expire', 'system');
    return;
  }
  const d = m.drivers.findIndex(
    (a, i) => a === 'available' && !m.offers.some((o) => o.ride === token && o.driver === i) && (seen?.includes(i) ?? true),
  );
  if (d < 0) return;
  moveDriver(m, d, 'reserve');
  m.offers.push({ ride: token, driver: d, status: 'pending', lapsed: false });
}

// Applies one single-transaction command (not a pair or timer) to the model and returns what the API must answer
export function apply(m: Model, c: Command): Outcome {
  switch (c.kind) {
    case 'book':
      if (m.rides.some((r) => r.rider === c.rider && RIDER_ACTIVE.includes(r.status))) return 409;
      m.rides.push({ token: c.token, rider: c.rider, status: 'searching', driver: null, order: ++m.clock });
      return 201;
    case 'sync':
      sync(m, c.ride);
      return 'ok';
    case 'deadline':
      rideOf(m, c.ride).order = ++m.clock - 1e9;
      return 'ok';
    case 'sweep': {
      const due = m.rides.filter((r) => r.status === 'searching' && !pendingOf(m, r.token)).sort(byOrder);
      for (const r of due) sync(m, r.token);
      return 'ok';
    }
    case 'reconcile': {
      const stale = m.offers.filter((o) => o.status === 'pending' && rideOf(m, o.ride).status !== 'searching');
      for (const o of stale) sync(m, o.ride);
      return { lostTimers: 0, staleOffers: stale.length, reservedWithoutOffer: 0, onTripWithoutRide: 0, stuckNoHeartbeat: 0, stuckOverCap: 0 };
    }
    case 'accept': {
      const o = offerOf(m, c.offer);
      if (o.driver !== c.by) return 404;
      const r = rideOf(m, o.ride);
      if (o.status !== 'pending' || o.lapsed || r.status !== 'searching') return 409;
      moveRide(r, 'accept', 'driver');
      r.driver = c.by;
      o.status = 'accepted';
      moveDriver(m, c.by, 'assign');
      return 200;
    }
    case 'decline': {
      const o = offerOf(m, c.offer);
      if (o.driver !== c.by) return 404;
      if (o.status !== 'pending') return 409;
      o.status = 'declined';
      moveDriver(m, c.by, 'release');
      return 200;
    }
    case 'lapse': {
      const o = offerOf(m, c.offer);
      if (o.status === 'pending') o.lapsed = true;
      return 'ok';
    }
    case 'cancel': {
      const r = rideOf(m, c.ride);
      if ('driver' in c.by && r.driver !== c.by.driver) return 404;
      if (!moveRide(r, 'cancel', 'rider' in c.by ? 'rider' : 'driver')) return 409;
      if (r.driver !== null) moveDriver(m, r.driver, 'finish');
      return 200;
    }
    case 'step': {
      const r = rideOf(m, c.ride);
      if (r.driver !== c.by) return 404;
      if (!moveRide(r, c.action, 'driver')) return 409;
      if (r.status === 'completed') moveDriver(m, c.by, 'finish');
      return 200;
    }
    case 'online': {
      if (m.drivers[c.driver] === (c.online ? 'available' : 'offline')) return 200;
      return moveDriver(m, c.driver, c.online ? 'go_online' : 'go_offline') ? 200 : 409;
    }
    case 'timer':
    case 'pair':
      throw new Error(`a ${c.kind} takes effect in steps; use expectations`);
  }
}

// One step per point where another transaction's commit can land. MatchingService.sync reads its candidates
// unlocked, then locks one from that list, so a driver released in between is missed; the ride lock it holds
// serialises everything else, so the read only needs driver availability. The timer's job (MatchingService.expire)
// expires the offer and releases its driver, then syncs the ride in a second transaction, only if it expired the offer.
function steps(m: Model, c: Command): (() => Outcome)[] {
  let seen: number[] | undefined;
  const read = () => {
    seen = m.drivers.flatMap((a, i) => (a === 'available' ? [i] : []));
    return 'ok';
  };
  if (c.kind === 'sync') {
    return [
      read,
      () => {
        sync(m, c.ride, seen);
        return 'ok';
      },
    ];
  }
  if (c.kind !== 'timer') return [() => apply(m, c)];
  let expired = false;
  return [
    () => {
      const o = offerOf(m, c.offer);
      if (o.status !== 'pending') return 'ok';
      o.status = 'expired';
      moveDriver(m, o.driver, 'release');
      expired = true;
      return 'ok';
    },
    () => (expired ? read() : 'ok'),
    () => {
      if (expired) sync(m, c.offer.ride, seen);
      return 'ok';
    },
  ];
}

// Every merge of two sequences that keeps each one's own order
export const interleavings = <T>(a: T[], b: T[]): T[][] =>
  !a.length || !b.length
    ? [[...a, ...b]]
    : [...interleavings(a.slice(1), b).map((r) => [a[0], ...r]), ...interleavings(a, b.slice(1)).map((r) => [b[0], ...r])];

// Every way the command could take effect, each with the model after it, the API's answer and the database state.
// A pair's two commands run at once, so their steps can interleave; a command's answer is its last step's.
export function expectations(model: Model, c: Command) {
  const cs = c.kind === 'pair' ? [c.a, c.b] : [c];
  const [a, b = []] = cs.map((x, i) => steps(model, x).map(() => i)); // step lengths only; nothing runs on model
  return interleavings(a, b).map((merge) => {
    const m = structuredClone(model);
    const pending = cs.map((x) => steps(m, x));
    const answers: Outcome[] = [];
    for (const i of merge) answers[i] = pending[i].shift()!();
    return { m, outcome: c.kind === 'pair' ? answers : answers[0], state: snapshot(m) };
  });
}

// What the database must hold: rides in created_at order, offers sorted, each driver's availability
export const snapshot = (m: Model) => ({
  rides: [...m.rides].sort(byOrder).map((r) => [r.token, r.status, r.driver]),
  offers: m.offers.map((o) => [o.ride, o.driver, o.status]).sort(),
  drivers: m.drivers,
});
