import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DriversRepository } from '../src/drivers/drivers.repository';
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
  // The debt limit is exactly one completed ride's commission (M6.9)
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase(), DRIVER_DEBT_LIMIT_MINOR: 1700 })).init();
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', 5000, 1700, 300, 0, 500, 1200, now() - interval '1 minute')`,
  );
});
afterAll(() => app.close());

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
  expect(quote.fare).toEqual({ amountMinor: 10_000, currency: 'KHR' });
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return { rider, driver, ride };
};
const assignedRide = async (...steps: string[]) => rideFor(await newDriver(), ...steps);
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
  // One driver and one rider for every round: signing in per round blew the 5 s budget under load (M6.10a)
  const driver = await newDriver();
  const rider = await signIn(app);
  for (let round = 0; round < 5; round++) {
    const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
    const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
    await assign(app, driver, ride.id);
    for (const s of ['arrive', 'start']) await step(driver, ride.id, s).expect(200);
    // The reused driver would pass the debt limit on the 2nd completion, so zero this ride's commission (KHR stays)
    await db().query('UPDATE rides SET commission_minor = 0 WHERE id = $1', [ride.id]);
    await using gate = await lockTable(db(), 'rides');
    const racing = Array.from({ length: N }, () => step(driver, ride.id, 'complete').then((r) => r));
    await gate.arrived(N);
    await gate.release();

    const statuses = (await Promise.all(racing)).map((r) => r.status).sort();
    expect(statuses).toEqual([HttpStatus.OK, ...Array<number>(N - 1).fill(HttpStatus.CONFLICT)]);
    const [state] = await db().query<{ status: string; version: number }[]>('SELECT status, version FROM rides WHERE id = $1', [
      ride.id,
    ]);
    expect(state).toEqual({ status: 'completed', version: 5 });
    expect(await entries(ride.id)).toEqual([{ driver_id: driver.id, kind: 'commission', amount_minor: '0', currency: 'KHR' }]);
  }
});

// PLAN.md M6.9: a driver goes online only while the KHR commission owed stays within the limit (1700 here)
describe('the debt limit on going online', () => {
  const setOnline = (driver: Actor, online: boolean) => http().put('/drivers/me/availability').set(driver.auth).send({ online });

  it('lets a driver who owes exactly the limit go offline and online again', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete');
    await setOnline(driver, false).expect(200, { availability: 'offline' });
    await setOnline(driver, true).expect(200, { availability: 'available' });
  });

  it('lets a driver past the limit go offline but not back online, and records no move', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete');
    await rideFor(driver, 'arrive', 'start', 'complete');
    // That completion ended the shift (M6.9a); a driver who drifted past the limit while available stands in for one
    await db().query(`UPDATE drivers SET availability = 'available' WHERE user_id = $1`, [driver.id]);
    await setOnline(driver, true).expect(200, { availability: 'available' }); // already available: a retry never checks
    await setOnline(driver, false).expect(200, { availability: 'offline' });
    const events = async () =>
      db().query<{ action: string }[]>('SELECT action FROM driver_availability_events WHERE driver_id = $1 ORDER BY id', [
        driver.id,
      ]);
    const before = await events();
    expect(before.at(-1)).toEqual({ action: 'go_offline' });
    await setOnline(driver, true).expect(403, {
      statusCode: 403,
      code: 'DEBT_LIMIT',
      message: 'Driver owes more commission than the limit',
      limitMinor: 1700,
      currency: 'KHR',
    });
    expect((await http().get('/drivers/me').set(driver.auth).expect(200)).body).toMatchObject({ availability: 'offline' });
    expect(await events()).toEqual(before);
  });

  it('counts only KHR entries: riel and cents never add up', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete');
    const { ride } = await rideFor(driver, 'arrive', 'start');
    await db().query(`UPDATE rides SET commission_minor = 5000, currency = 'USD' WHERE id = $1`, [ride.id]);
    await step(driver, ride.id, 'complete').expect(200);
    expect((await http().get('/drivers/me').set(driver.auth).expect(200)).body).toMatchObject({ availability: 'available' });
    await setOnline(driver, false).expect(200);
    await setOnline(driver, true).expect(200, { availability: 'available' });
  });

  it('lets a driver with no entries go online, whatever other drivers owe', async () => {
    const { driver: indebted } = await assignedRide('arrive', 'start', 'complete');
    await rideFor(indebted, 'arrive', 'start', 'complete');
    const [{ total }] = await db().query<{ total: string }[]>(
      `SELECT sum(amount_minor) AS total FROM driver_ledger_entries WHERE currency = 'KHR'`,
    );
    expect(Number(total)).toBeLessThan(-1700);
    const driver = await newDriver();
    await setOnline(driver, true).expect(200, { availability: 'available' });
  });

  // M6.9b: a completion that commits its debit and debt_stop while going online is in flight. The gate transaction
  // plays that completion; SHARE lets the request's state read through and holds its availability UPDATE.
  it('refuses going online when a completion past the limit commits mid-request', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete'); // owes exactly the limit
    const { ride } = await rideFor(driver, 'arrive', 'start');
    await using gate = await lockTable(db(), 'drivers', 'SHARE');
    await gate.manager.query(
      `INSERT INTO driver_ledger_entries (driver_id, ride_id, kind, amount_minor, currency) VALUES ($1, $2, 'commission', -1700, 'KHR')`,
      [driver.id, ride.id],
    );
    expect(await app.get(DriversRepository).move(gate.manager, driver.id, 'debt_stop')).toBe(true);
    const racing = setOnline(driver, true).then((r) => r);
    await gate.arrived(1);
    await gate.release();

    const res = await racing;
    expect({ status: res.status, body: res.body as unknown }).toEqual({
      status: 403,
      body: {
        statusCode: 403,
        code: 'DEBT_LIMIT',
        message: 'Driver owes more commission than the limit',
        limitMinor: 1700,
        currency: 'KHR',
      },
    });
    expect((await http().get('/drivers/me').set(driver.auth).expect(200)).body).toMatchObject({ availability: 'offline' });
    const [last] = await db().query<{ action: string }[]>(
      'SELECT action FROM driver_availability_events WHERE driver_id = $1 ORDER BY id DESC LIMIT 1',
      [driver.id],
    );
    expect(last).toEqual({ action: 'debt_stop' });
  });
});

// PLAN.md M6.9a: the ride end that leaves the driver past the limit ends their shift, in the ride's own transaction
describe('the debt limit at the end of a trip', () => {
  const availability = async (driver: Actor) =>
    ((await http().get('/drivers/me').set(driver.auth).expect(200)).body as { availability: string }).availability;
  const lastEvent = async (driver: Actor) =>
    (
      await db().query<{ action: string; from_state: string; to_state: string }[]>(
        'SELECT action, from_state, to_state FROM driver_availability_events WHERE driver_id = $1 ORDER BY id DESC LIMIT 1',
        [driver.id],
      )
    )[0];
  const debtStop = { action: 'debt_stop', from_state: 'on_trip', to_state: 'offline' };
  const refused = (driver: Actor) =>
    http().put('/drivers/me/availability').set(driver.auth).send({ online: true }).expect(403).expect((r) => {
      expect(r.body).toMatchObject({ code: 'DEBT_LIMIT' });
    });

  it('sends a driver whose completion crosses the limit offline instead of available', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete');
    expect(await availability(driver)).toBe('available'); // owes exactly the limit
    await rideFor(driver, 'arrive', 'start', 'complete');
    expect(await availability(driver)).toBe('offline');
    expect(await lastEvent(driver)).toEqual(debtStop);
    await refused(driver);
  });

  it('sends a driver offline when a ride is cancelled past the limit', async () => {
    const { driver } = await assignedRide('arrive', 'start', 'complete');
    const { rider, ride } = await rideFor(driver);
    // Stands in for a limit lowered mid-trip: the driver is now 1 riel past it before the ride ends
    await db().query(
      `INSERT INTO driver_ledger_entries (driver_id, ride_id, kind, amount_minor, currency) VALUES ($1, $2, 'commission', -1, 'KHR')`,
      [driver.id, ride.id],
    );
    await step(rider, ride.id, 'cancel').send({ reason: 'changed_mind' }).expect(200);
    expect(await availability(driver)).toBe('offline');
    expect(await lastEvent(driver)).toEqual(debtStop);
    await refused(driver);
  });
});
