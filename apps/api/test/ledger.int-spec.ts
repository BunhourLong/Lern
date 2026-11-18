import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { lockTable } from './support/gate';
import { isolatedDatabase } from './support/isolated-database';
import { assign } from './support/offers';

// PLAN.md M6.8: completing a cash ride appends what the driver owes, -commission, in the completion's own statement.
// OSRM is down (test default): the straight-line trip of commission.int-spec on its card is 9500 riel + the 500
// fee = 10 000; at 1200 bp, 9500 × 12% = 1140 → 1200, plus the whole fee: the driver owes 1700.
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Own database: its card would re-price other suites' quotes, and the race gate counts lock waiters database-wide
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', 5000, 1700, 300, 0, 500, 1200, now() - interval '1 minute')`,
  );
});
afterAll(() => app.close());

const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
// A fresh rider's ride accepted by a fresh verified driver, walked on with the driver's steps
const assignedRide = async (...steps: string[]) => {
  const rider = await signIn(app);
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  expect(quote.fare).toEqual({ amountMinor: 10_000, currency: 'KHR' });
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'moto', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  const driver = await signIn(app, me.phone); // a fresh token carries the driver role
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return { rider, driver, ride };
};
const entries = (rideId: string) =>
  db().query<{ driver_id: string; kind: string; amount_minor: string; currency: string }[]>(
    'SELECT driver_id, kind, amount_minor, currency FROM driver_ledger_entries WHERE ride_id = $1',
    [rideId],
  );
const owes = (driver: Actor) => [{ driver_id: driver.id, kind: 'commission', amount_minor: '-1700', currency: 'KHR' }];

it('appends one commission debit for the driver when the ride completes, at the completion time', async () => {
  const { driver, ride } = await assignedRide('arrive', 'start', 'complete');
  expect(await entries(ride.id)).toEqual(owes(driver));
  const [{ same }] = await db().query<{ same: boolean }[]>(
    `SELECT l.created_at = e.created_at AS same FROM driver_ledger_entries l
     JOIN ride_events e ON e.ride_id = l.ride_id AND e.status = 'completed' WHERE l.ride_id = $1`,
    [ride.id],
  );
  expect(same).toBe(true);
});

it("copies the ride's own snapshot, a zero commission and another currency included", async () => {
  const { driver, ride } = await assignedRide('arrive', 'start');
  await db().query(`UPDATE rides SET commission_minor = 0, currency = 'USD' WHERE id = $1`, [ride.id]);
  await step(driver, ride.id, 'complete').expect(200);
  expect(await entries(ride.id)).toEqual([{ driver_id: driver.id, kind: 'commission', amount_minor: '0', currency: 'USD' }]);
});

it('owes nothing for a ride cancelled at pickup or still in progress', async () => {
  const cancelled = await assignedRide('arrive');
  await step(cancelled.rider, cancelled.ride.id, 'cancel').send({ reason: 'changed_mind' }).expect(200);
  expect(await entries(cancelled.ride.id)).toEqual([]);
  const riding = await assignedRide('arrive', 'start');
  expect(await entries(riding.ride.id)).toEqual([]);
});

// The driver's complete retried N times (no Idempotency-Key). Gate: an exclusive lock on rides holds every complete
// at its guarded ride UPDATE until all N have arrived. N + gate + this monitor fit the pool of 10.
it('lets exactly one of 8 parallel completes win and append exactly one entry', async () => {
  const N = 8;
  for (let round = 0; round < 5; round++) {
    const { driver, ride } = await assignedRide('arrive', 'start');
    const gate = await lockTable(db(), 'rides');
    const racing = Array.from({ length: N }, () => step(driver, ride.id, 'complete').then((r) => r));
    await gate.arrived(N);
    await gate.release();

    const statuses = (await Promise.all(racing)).map((r) => r.status).sort();
    expect(statuses).toEqual([HttpStatus.OK, ...Array<number>(N - 1).fill(HttpStatus.CONFLICT)]);
    const [state] = await db().query<{ status: string; version: number }[]>('SELECT status, version FROM rides WHERE id = $1', [
      ride.id,
    ]);
    expect(state).toEqual({ status: 'completed', version: 5 });
    expect(await entries(ride.id)).toEqual(owes(driver));
  }
});
