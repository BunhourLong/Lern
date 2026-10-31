import type { Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import fc from 'fast-check';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingService } from '../src/matching/matching.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { violations } from './support/invariants';
import { isolatedDatabase } from './support/isolated-database';
import {
  apply,
  type Command,
  DRIVERS,
  initialModel,
  type OfferRef,
  type Outcome,
  type Raw,
  resolve,
  RIDERS,
  snapshot,
} from './support/ride-model';

// PLAN.md M4: random sequences of rider, driver and timer commands against the real API and a pure model of the
// three state machines. After every command the answer and the database match the model, and no invariant query
// finds a violation. A `pair` runs two commands at once; the result must match one of their two orders.
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
        // Every order the command could have taken effect in, with what the model says for each
        const orders = c.kind === 'pair' ? [[c.a, c.b], [c.b, c.a]] : [[c]];
        const expected = orders.map((order) => {
          const m = structuredClone(model);
          const outcomes = order.map((o) => apply(m, o));
          const answer = c.kind !== 'pair' ? outcomes[0] : order[0] === c.a ? outcomes : outcomes.reverse();
          return { m, seen: { step, command: c, outcome: answer, state: snapshot(m) } };
        });
        const seen = { step, command: c, outcome, state };
        expect(expected.map((e) => e.seen)).toContainEqual(seen);
        model = expected.find((e) => JSON.stringify(e.seen) === JSON.stringify(seen))!.m; // same key order both sides
        expect({ step, violations: await violations(db()) }).toEqual({ step, violations: [] });
      }
    }),
    { numRuns: 100 },
  );
}, 600_000);
