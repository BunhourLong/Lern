import type { Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import fc from 'fast-check';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { EtaProvider } from '../src/matching/eta.provider';
import { MatchingRepository } from '../src/matching/matching.repository';
import { MatchingService } from '../src/matching/matching.service';
import { RidesRepository } from '../src/rides/rides.repository';
import { type Actor, bootApp, signIn } from './support/actors';
import { violations } from './support/invariants';
import { isolatedDatabase } from './support/isolated-database';
import {
  apply,
  type Command,
  DRIVERS,
  expectations,
  initialModel,
  interleavings,
  type OfferRef,
  type Outcome,
  type Raw,
  resolve,
  RIDERS,
  snapshot,
} from './support/ride-model';

// PLAN.md M4: random sequences of rider, driver and timer commands against the real API and a pure model of the
// three state machines. After every command the answer and the database match the model, and no invariant query
// finds a violation. A `pair` runs two commands at once; the result must match some interleaving of their transactions.
// Nothing runs on its own (no worker, sweep or reconcile timer) and wall time decides nothing (TTL and deadline
// 600 s): syncs, sweeps, offers going due, timers firing and the deadline passing are commands. A lapsed offer is
// due only 1 ms before the next command, far inside the reconciler's 5 s grace for lost timers.

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const matching = () => app.get(MatchingService);
const riders: Actor[] = [];
const drivers: Actor[] = [];
const pickup = { lat: 11.5564, lng: 104.9282 };
const north = (m: number) => ({ lat: pickup.lat + m / 111_320, lng: pickup.lng });

beforeAll(async () => {
  app = await (
    await bootApp({}, { DATABASE_URL: await isolatedDatabase(), OFFER_TTL_SECONDS: 600, SEARCH_DEADLINE_SECONDS: 600 })
  ).init();
  for (let i = 0; i < RIDERS; i++) riders.push(await signIn(app));
  for (let i = 0; i < DRIVERS; i++) {
    const me = await signIn(app);
    await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
    await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
    const d = await signIn(app, me.phone); // a fresh token carries the driver role
    const recordedAt = new Date().toISOString();
    await http().post('/drivers/me/locations').set(d.auth).send({ points: [{ ...north((i + 1) * 300), recordedAt }] }).expect(200);
    drivers.push(d);
  }
});

afterAll(() => app.close());

// Every run starts from no rides and every driver available and freshly seen (isolated database)
async function reset() {
  const ids = drivers.map((d) => d.id);
  await db().query('TRUNCATE quotes, rides, ride_offers, ride_events, outbox_events CASCADE');
  await db().query(`UPDATE drivers SET availability = 'available' WHERE user_id = ANY($1)`, [ids]);
  await db().query('UPDATE driver_locations SET received_at = now() WHERE driver_id = ANY($1)', [ids]);
}

async function offerId(ref: OfferRef, rideIds: Map<string, string>): Promise<string> {
  const [{ id }] = await db().query<{ id: string }[]>('SELECT id FROM ride_offers WHERE ride_id = $1 AND driver_id = $2', [
    rideIds.get(ref.ride),
    drivers[ref.driver].id,
  ]);
  return id;
}

async function run(c: Command, rideIds: Map<string, string>): Promise<Outcome> {
  const ride = (token: string) => rideIds.get(token)!;
  switch (c.kind) {
    case 'book': {
      const rider = riders[c.rider];
      const trip = { pickup, dropoff: north(-3000), vehicleType: 'remork' };
      const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
      const res = await http().post('/rides').set(rider.auth).send({ quoteId: quote.id });
      if (res.status === 201) rideIds.set(c.token, (res.body as Ride).id);
      return res.status;
    }
    case 'sync':
      await matching().sync(ride(c.ride));
      return 'ok';
    case 'deadline':
      await db().query(`UPDATE rides SET created_at = now() - interval '601 seconds' WHERE id = $1`, [ride(c.ride)]);
      return 'ok';
    case 'sweep':
      await matching().sweep();
      return 'ok';
    case 'reconcile':
      return matching().reconcile();
    case 'accept':
    case 'decline': {
      const id = await offerId(c.offer, rideIds);
      return (await http().post(`/offers/${id}/${c.kind}`).set(drivers[c.by].auth)).status;
    }
    case 'timer':
    case 'lapse': {
      const id = await offerId(c.offer, rideIds);
      await db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 millisecond' WHERE id = $1 AND status = 'pending'`, [id]);
      if (c.kind === 'timer') await matching().expire(id);
      return 'ok';
    }
    case 'cancel': {
      const who = 'rider' in c.by ? riders[c.by.rider] : drivers[c.by.driver];
      return (await http().post(`/rides/${ride(c.ride)}/cancel`).set(who.auth).send({ reason: 'changed_mind' })).status;
    }
    case 'step':
      return (await http().post(`/rides/${ride(c.ride)}/${c.action}`).set(drivers[c.by].auth)).status;
    case 'online':
      return (await http().put('/drivers/me/availability').set(drivers[c.driver].auth).send({ online: c.online })).status;
    case 'pair':
      return Promise.all([attempt(c.a, rideIds), attempt(c.b, rideIds)]);
  }
}

// A job that throws is an answer the model never gives
const attempt = (c: Command, rideIds: Map<string, string>): Promise<Outcome> =>
  run(c, rideIds).catch((err: Error) => `threw: ${err.message}`);

// The database in the model's terms: rides by booking token, drivers by index
async function observed(rideIds: Map<string, string>) {
  const token = new Map([...rideIds].map(([t, id]) => [id, t]));
  const driver = (id: string | null) => (id === null ? null : drivers.findIndex((d) => d.id === id));
  const rides = await db().query<{ id: string; status: string; driver_id: string | null }[]>(
    'SELECT id, status, driver_id FROM rides ORDER BY created_at',
  );
  const offers = await db().query<{ ride_id: string; driver_id: string; status: string }[]>(
    'SELECT ride_id, driver_id, status FROM ride_offers',
  );
  const availability = await db().query<{ user_id: string; availability: string }[]>(
    'SELECT user_id, availability FROM drivers WHERE user_id = ANY($1)',
    [drivers.map((d) => d.id)],
  );
  return {
    rides: rides.map((r) => [token.get(r.id), r.status, driver(r.driver_id)]),
    offers: offers.map((o) => [token.get(o.ride_id), driver(o.driver_id), o.status]).sort(),
    drivers: drivers.map((d) => availability.find((a) => a.user_id === d.id)!.availability),
  };
}

const index = fc.nat({ max: 20 });
const driver = fc.nat({ max: DRIVERS - 1 });
const single: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('book' as const), rider: fc.nat({ max: RIDERS - 1 }) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('sync' as const), ride: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deadline' as const), ride: index }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constantFrom('accept' as const, 'decline' as const),
      offer: index,
      by: fc.oneof({ weight: 3, arbitrary: fc.constant('own' as const) }, driver),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('timer' as const), offer: index }) },
  // Due by the DB clock, timer not fired yet: only accept must change its answer (invariant 3)
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('lapse' as const), offer: index }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('cancel' as const),
      ride: index,
      by: fc.oneof(fc.constant('rider' as const), fc.constant('assigned' as const), driver),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('step' as const),
      ride: index,
      action: fc.constantFrom('arrive' as const, 'start' as const, 'complete' as const),
      by: fc.oneof({ weight: 3, arbitrary: fc.constant('assigned' as const) }, driver),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('online' as const), driver, online: fc.boolean() }) },
);
// Sweep and reconcile read their list first, so they aren't atomic and stay out of pairs
const command: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 10, arbitrary: single },
  { weight: 2, arbitrary: fc.constantFrom<Raw>({ kind: 'sweep' }, { kind: 'reconcile' }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('pair' as const), a: single, b: single }) },
);

// M5.20, seed 1497383226: accepting a dead offer wrote rides.driver_id (FK → FOR KEY SHARE on the driver row) before
// the offer check failed, so a concurrent sync's SKIP LOCKED passed over that available driver
it('a stale accept never hides its driver from a concurrent sync', async () => {
  await reset();
  const rideIds = new Map<string, string>();
  const offer0 = { ride: '0', driver: 0 };
  for (const c of [
    { kind: 'book', rider: 0, token: '0' },
    { kind: 'sync', ride: '0' },
    { kind: 'decline', offer: offer0, by: 0 },
    { kind: 'book', rider: 1, token: '1' },
  ] satisfies Command[]) {
    expect(await run(c, rideIds)).not.toEqual(expect.stringMatching(/^threw/));
  }
  const id = await offerId(offer0, rideIds);
  const repo = app.get(MatchingRepository);
  const real = repo.accept.bind(repo);
  let reached!: () => void;
  const reachedP = new Promise<'reached'>((r) => (reached = () => r('reached')));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const spy = jest.spyOn(repo, 'accept').mockImplementation(async (...args) => {
    reached();
    await gate;
    return real(...args);
  });
  const accept = http().post(`/offers/${id}/accept`).set(drivers[0].auth).then((res) => res);
  try {
    // Fixed code answers before the guarded UPDATE; the old code pauses there with ride 0 assigned in its transaction
    if ((await Promise.race([reachedP, accept])) === 'reached') {
      const visible = await db().query<unknown[]>(`SELECT 1 FROM drivers WHERE user_id = $1 FOR UPDATE SKIP LOCKED`, [drivers[0].id]);
      expect({ driver0LockedByStaleAccept: visible.length === 0 }).toEqual({ driver0LockedByStaleAccept: true });
    }
    await run({ kind: 'sync', ride: '1' }, rideIds);
  } finally {
    release();
    await accept.catch(() => undefined); // settled before the next test resets the tables
    spy.mockRestore();
  }
  const res = await accept;
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ code: 'INVALID_TRANSITION', offer: { id, status: 'declined' } });
  expect(await observed(rideIds)).toEqual({
    rides: [
      ['0', 'searching', null],
      ['1', 'searching', null],
    ],
    offers: [
      ['0', 0, 'declined'],
      ['1', 0, 'pending'],
    ],
    drivers: ['reserved', 'available', 'available'],
  });
  expect(await violations(db())).toEqual([]);
});

// M5.22, seed -378302069: expire is two transactions (expire + release, then sync), so two timers can both release
// their drivers before either ride syncs, an outcome neither serial order gives
it('two timers that both release before either sync match the model', async () => {
  await reset();
  const rideIds = new Map<string, string>();
  const model = initialModel();
  for (const c of [
    { kind: 'book', rider: 0, token: 'X' },
    { kind: 'sync', ride: 'X' },
    { kind: 'book', rider: 1, token: 'Y' },
    { kind: 'sync', ride: 'Y' },
  ] satisfies Command[]) {
    expect(await run(c, rideIds)).toEqual(apply(model, c));
  }
  expect(await observed(rideIds)).toEqual(snapshot(model)); // X offered to d0, Y to d1, d2 free
  const pair: Command = {
    kind: 'pair',
    a: { kind: 'timer', offer: { ride: 'X', driver: 0 } },
    b: { kind: 'timer', offer: { ride: 'Y', driver: 1 } },
  };
  const svc = matching();
  const real = svc.sync.bind(svc);
  let arrived = 0;
  let open!: () => void;
  const barrier = new Promise<void>((r) => (open = r));
  const spy = jest.spyOn(svc, 'sync').mockImplementation(async (rideId) => {
    if (++arrived === 2) open();
    await barrier; // each expire's sync waits until both timers have committed their release
    return real(rideId);
  });
  let outcome: Outcome;
  try {
    outcome = await run(pair, rideIds);
  } finally {
    spy.mockRestore();
  }
  const state = await observed(rideIds);
  // The gate held: each ride got the nearest driver free once both were released
  expect({ outcome, state }).toEqual({
    outcome: ['ok', 'ok'],
    state: {
      rides: [
        ['X', 'searching', null],
        ['Y', 'searching', null],
      ],
      offers: [
        ['X', 0, 'expired'],
        ['X', 1, 'pending'],
        ['Y', 0, 'pending'],
        ['Y', 1, 'expired'],
      ],
      drivers: ['reserved', 'reserved', 'available'],
    },
  });
  expect(await violations(db())).toEqual([]);
  expect(expectations(model, pair).map((e) => ({ outcome: e.outcome, state: e.state }))).toContainEqual({ outcome, state });
});

// M5.24: sync reads its candidates unlocked, ranks them, then locks one from that list, so a driver released in
// between (here by X's timer) is missed: X→d1 and Y→d2 with d0 free, which only a read-then-lock sync gives
it("a driver released between sync's candidate read and its lock is missed, as the model says", async () => {
  await reset();
  const rideIds = new Map<string, string>();
  const model = initialModel();
  for (const c of [
    { kind: 'book', rider: 0, token: 'X' },
    { kind: 'sync', ride: 'X' },
    { kind: 'book', rider: 1, token: 'Y' },
  ] satisfies Command[]) {
    expect(await run(c, rideIds)).toEqual(apply(model, c));
  }
  expect(await observed(rideIds)).toEqual(snapshot(model)); // X offered to d0, Y searching with no offer
  const eta = app.get(EtaProvider);
  const real = eta.rank.bind(eta);
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const spy = jest.spyOn(eta, 'rank').mockImplementationOnce(async (...args) => {
    reached();
    await gate; // Y's sync holds its candidate list (d1, d2) while X's timer frees d0
    return real(...args);
  });
  const syncY = matching().sync(rideIds.get('Y')!);
  try {
    // A sync that returned without ranking would leave the one-shot gate to X's timer, which would then hang
    expect(await Promise.race([reachedP.then(() => 'reached'), syncY.then(() => 'returned')])).toBe('reached');
    expect(await run({ kind: 'timer', offer: { ride: 'X', driver: 0 } }, rideIds)).toBe('ok');
  } finally {
    open();
    await syncY.catch(() => undefined);
    spy.mockRestore();
  }
  await syncY;
  expect(await observed(rideIds)).toEqual({
    rides: [
      ['X', 'searching', null],
      ['Y', 'searching', null],
    ],
    offers: [
      ['X', 0, 'expired'],
      ['X', 1, 'pending'],
      ['Y', 2, 'pending'],
    ],
    drivers: ['available', 'reserved', 'reserved'],
  });
  expect(await violations(db())).toEqual([]);
  // X's new offer to x, Y's to y, the third driver free
  const offered = (x: number, y: number) =>
    JSON.stringify({
      rides: [
        ['X', 'searching', null],
        ['Y', 'searching', null],
      ],
      offers: [
        ['X', 0, 'expired'],
        ['X', x, 'pending'],
        ['Y', y, 'pending'],
      ].sort(),
      drivers: [0, 1, 2].map((d) => (d === x || d === y ? 'reserved' : 'available')),
    });
  const pair: Command = { kind: 'pair', a: { kind: 'timer', offer: { ride: 'X', driver: 0 } }, b: { kind: 'sync', ride: 'Y' } };
  expect(new Set(expectations(model, pair).map((e) => JSON.stringify(e.state)))).toEqual(
    new Set([offered(2, 1), offered(1, 2), offered(1, 0)]),
  );
});

// CI seed -1853268774: a driver's move runs its guarded UPDATE, then on a miss reads the ride in a separate
// READ COMMITTED statement, so an accept committing in between makes the driver a participant: 409, not 404
it('a driver move that misses just before an accept commits answers 409, as the model says', async () => {
  await reset();
  const rideIds = new Map<string, string>();
  const model = initialModel();
  for (const c of [
    { kind: 'book', rider: 0, token: 'X' },
    { kind: 'sync', ride: 'X' },
  ] satisfies Command[]) {
    expect(await run(c, rideIds)).toEqual(apply(model, c));
  }
  const repo = app.get(RidesRepository);
  const real = repo.findForParticipant.bind(repo);
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const spy = jest.spyOn(repo, 'findForParticipant').mockImplementationOnce(async (...args) => {
    reached();
    await gate; // the arrive's UPDATE has missed (no driver yet) while the accept commits
    return real(...args);
  });
  const accept: Command = { kind: 'accept', offer: { ride: 'X', driver: 0 }, by: 0 };
  const arrive: Command = { kind: 'step', ride: 'X', action: 'arrive', by: 0 };
  const stepped = attempt(arrive, rideIds);
  let accepted: Outcome;
  try {
    // An arrive that answered without the read would leave the one-shot gate to the accept, which would then hang
    expect(await Promise.race([reachedP.then(() => 'reached'), stepped.then(() => 'returned')])).toBe('reached');
    accepted = await run(accept, rideIds);
  } finally {
    open();
    await stepped;
    spy.mockRestore();
  }
  const outcome = [accepted, await stepped];
  const state = await observed(rideIds);
  expect({ outcome, state }).toEqual({
    outcome: [200, 409],
    state: { rides: [['X', 'driver_assigned', 0]], offers: [['X', 0, 'accepted']], drivers: ['on_trip', 'available', 'available'] },
  });
  expect(await violations(db())).toEqual([]);
  const seen = (pair: Command) => expectations(model, pair).map((e) => ({ outcome: e.outcome, state: e.state }));
  expect(seen({ kind: 'pair', a: accept, b: arrive })).toContainEqual({ outcome, state });
  // A driver's cancel goes through the same two statements
  expect(seen({ kind: 'pair', a: accept, b: { kind: 'cancel', ride: 'X', by: { driver: 0 } } })).toContainEqual({ outcome, state });
});

it('interleaves two step lists in every order that keeps each list in its own order', () => {
  expect(interleavings([1, 2], [3])).toEqual([
    [1, 2, 3],
    [1, 3, 2],
    [3, 1, 2],
  ]);
});

it('keeps every answer and the database equal to the model, with no invariant broken', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(command, { maxLength: 40, size: 'max' }), async (raws) => {
      await reset();
      let model = initialModel();
      const rideIds = new Map<string, string>();
      for (const [step, raw] of raws.entries()) {
        const c = resolve(model, raw, String(step));
        if (!c) continue;
        const outcome = await attempt(c, rideIds);
        const state = await observed(rideIds);
        const expected = expectations(model, c).map(({ m, outcome, state }) => ({ m, seen: { step, command: c, outcome, state } }));
        const seen = { step, command: c, outcome, state };
        expect(expected.map((e) => e.seen)).toContainEqual(seen);
        model = expected.find((e) => JSON.stringify(e.seen) === JSON.stringify(seen))!.m; // same key order both sides
        expect({ step, violations: await violations(db()) }).toEqual({ step, violations: [] });
      }
    }),
    { numRuns: 100 },
  );
}, 600_000);
