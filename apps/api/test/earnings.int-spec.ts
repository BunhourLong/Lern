import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { assign } from './support/offers';

// PLAN.md M6.13: a driver's earnings per Phnom Penh day or ISO week, from the ledger. Same card as ledger.int-spec:
// every ride's fare is 10 000 riel and the driver owes 1700 commission, so earns 8300.
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init(); // own database: the cards re-price quotes
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', 5000, 1700, 300, 0, 500, 1200, now() - interval '1 minute')`,
  );
});
afterAll(() => app.close());

type Query = { by?: string; from?: string; to?: string };
const earnings = (a: Actor, query: Query) => http().get('/drivers/me/earnings').query(query).set(a.auth);
const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const newDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'moto', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
// A fresh rider's ride accepted by the driver, walked on with the driver's steps
const rideFor = async (driver: Actor, ...steps: string[]) => {
  const rider = await signIn(app);
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return ride;
};
// A ride the driver started through the API, with its ledger row at a fixed instant (a real complete dates it now()),
// then closed in SQL so the driver can take the next ride
const rideAt = async (driver: Actor, at: string, amountMinor = -1700, currency = 'KHR') => {
  const ride = await rideFor(driver, 'arrive', 'start');
  await db().query(
    `INSERT INTO driver_ledger_entries (driver_id, ride_id, kind, amount_minor, currency, created_at)
     VALUES ($1, $2, 'commission', $3, $4, $5)`,
    [driver.id, ride.id, amountMinor, currency, at],
  );
  await db().query(`UPDATE rides SET status = 'completed', version = version + 1 WHERE id = $1`, [ride.id]);
  await db().query(`UPDATE drivers SET availability = 'available' WHERE user_id = $1`, [driver.id]);
  return ride;
};
const money = (amountMinor: number) => ({ amountMinor, currency: 'KHR' });
const bucket = (start: string, rides: number, fare: number, commission: number) => ({
  start,
  rides,
  fare: money(fare),
  commission: money(commission),
  earnings: money(fare - commission),
});
const day = (from: string, to = from) => ({ by: 'day', from, to });

it('sums a really completed ride into its Phnom Penh day', async () => {
  const driver = await newDriver();
  const ride = await rideFor(driver, 'arrive', 'start', 'complete');
  // The completion's own local date, so a run across midnight can't flake
  const [{ today }] = await db().query<{ today: string }[]>(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Phnom_Penh', 'YYYY-MM-DD') AS today FROM driver_ledger_entries WHERE ride_id = $1`,
    [ride.id],
  );
  const res = await earnings(driver, day(today));
  expect(res.status).toBe(HttpStatus.OK);
  expect(res.body).toEqual({ buckets: [bucket(today, 1, 10_000, 1700)] });
});

it('splits days at Phnom Penh midnight, in the buckets and in the from/to bounds', async () => {
  const driver = await newDriver();
  await rideAt(driver, '2026-11-09T16:59:59.999999Z'); // 23:59:59.999999 on the 9th in Phnom Penh
  await rideAt(driver, '2026-11-09T17:00:00Z'); // 00:00 on the 10th
  expect((await earnings(driver, day('2026-11-09', '2026-11-10'))).body).toEqual({
    buckets: [bucket('2026-11-09', 1, 10_000, 1700), bucket('2026-11-10', 1, 10_000, 1700)],
  });
  expect((await earnings(driver, day('2026-11-10'))).body).toEqual({ buckets: [bucket('2026-11-10', 1, 10_000, 1700)] });
  expect((await earnings(driver, day('2026-11-09'))).body).toEqual({ buckets: [bucket('2026-11-09', 1, 10_000, 1700)] });
});

it('buckets by ISO week from Monday, and snaps from/to to whole weeks', async () => {
  const driver = await newDriver();
  await rideAt(driver, '2026-11-15T23:59:00+07:00'); // Sunday
  await rideAt(driver, '2026-11-16T00:00:00+07:00'); // Monday
  await rideAt(driver, '2026-11-22T23:59:00+07:00'); // Sunday, same week
  await rideAt(driver, '2026-11-23T00:00:00+07:00'); // next Monday
  expect((await earnings(driver, { by: 'week', from: '2026-11-09', to: '2026-11-16' })).body).toEqual({
    buckets: [bucket('2026-11-09', 1, 10_000, 1700), bucket('2026-11-16', 2, 20_000, 3400)],
  });
  // Wednesday: its week runs from the Monday through the Sunday, and stops before the next Monday
  expect((await earnings(driver, { by: 'week', from: '2026-11-18', to: '2026-11-18' })).body).toEqual({
    buckets: [bucket('2026-11-16', 2, 20_000, 3400)],
  });
});

it("counts only the caller's own KHR commission rows, and sums rides of one day", async () => {
  const driver = await newDriver();
  const other = await newDriver();
  await rideAt(driver, '2026-11-11T03:00:00Z');
  await rideAt(driver, '2026-11-11T09:00:00Z');
  await rideAt(driver, '2026-11-11T10:00:00Z', -50, 'USD');
  await rideAt(other, '2026-11-11T04:00:00Z');
  // In progress, no ledger row yet, though booked and moved on the queried day
  const riding = await rideFor(driver, 'arrive', 'start');
  const booked = '2026-11-11T05:00:00Z';
  await db().query('UPDATE rides SET created_at = $2 WHERE id = $1', [riding.id, booked]);
  await db().query('UPDATE ride_events SET created_at = $2 WHERE ride_id = $1', [riding.id, booked]);
  expect((await earnings(driver, day('2026-11-11'))).body).toEqual({ buckets: [bucket('2026-11-11', 2, 20_000, 3400)] });
  expect((await earnings(other, day('2026-11-11'))).body).toEqual({ buckets: [bucket('2026-11-11', 1, 10_000, 1700)] });
});

it('answers 404 to a non-driver, 401 without a token, and serves pending and suspended drivers', async () => {
  const user = await signIn(app);
  const res = await earnings(user, day('2026-11-11'));
  expect(res.status).toBe(HttpStatus.NOT_FOUND);
  expect(res.body).toMatchObject({ message: 'Not a driver' });
  expect((await http().get('/drivers/me/earnings').query(day('2026-11-11'))).status).toBe(HttpStatus.UNAUTHORIZED);

  const driver = await newDriver();
  await rideAt(driver, '2026-11-11T03:00:00Z');
  const earned = { buckets: [bucket('2026-11-11', 1, 10_000, 1700)] };
  for (const verification of ['pending', 'suspended']) {
    await db().query('UPDATE drivers SET verification = $2 WHERE user_id = $1', [driver.id, verification]);
    expect({ verification, body: (await earnings(driver, day('2026-11-11'))).body as unknown }).toEqual({ verification, body: earned });
  }
});

it('answers 400 to a bad query, and allows a span of up to 366 days', async () => {
  const driver = await newDriver();
  for (const q of [
    { from: '2026-11-11', to: '2026-11-11' },
    { ...day('2026-11-11'), by: 'month' },
    { by: 'day', to: '2026-11-11' },
    day('2026-02-30', '2026-03-01'),
    day('2026-11-12', '2026-11-11'),
    day('2026-01-01', '2027-01-03'), // 367 days
    day('0000-01-01', '0000-01-02'), // Postgres has no year 0
  ]) {
    expect({ q, status: (await earnings(driver, q)).status }).toEqual({ q, status: HttpStatus.BAD_REQUEST });
  }
  expect((await earnings(driver, day('2026-01-01', '2027-01-02'))).status).toBe(HttpStatus.OK);
});

// Last: the newer card would re-price the quotes of the tests above
it('takes the commission from the ledger, not the ride or any rate card', async () => {
  const driver = await newDriver();
  await rideAt(driver, '2026-11-12T05:00:00Z', -999); // the ride itself snapshotted 1700
  const before = await earnings(driver, day('2026-11-12'));
  expect(before.body).toEqual({ buckets: [bucket('2026-11-12', 1, 10_000, 999)] });
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', 9000, 2000, 400, 0, 800, 2000, now())`,
  );
  expect((await earnings(driver, day('2026-11-12'))).text).toBe(before.text);
});
