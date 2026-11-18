import type { Point, Quote, Ride, VehicleType } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PRICING_CONFIG, type PricingConfig } from '../src/pricing/pricing.config';
import { SurgeService } from '../src/pricing/surge.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

// PLAN.md M6.5: every SURGE_INTERVAL_MS, one multiplier per (vehicle type, H3 res-8 cell) lands in Redis.
// The rule is small here so each run's 500 bp step and the exact target are easy to see by eye.

let databaseUrl: string;
let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const surge = () => app.get(SurgeService);
const redis = () => app.get(Redis);
const prefix = () => app.get<PricingConfig>(PRICING_CONFIG).QUEUE_PREFIX;
const key = (vehicleType: VehicleType) => `${prefix()}:surge:${vehicleType}`;
const cell = (p: Point) => latLngToCell(p.lat, p.lng, 8);
const valueAt = async (p: Point, vehicleType: VehicleType = 'remork') => (await redis().hgetall(key(vehicleType)))[cell(p)];

beforeAll(async () => {
  databaseUrl = await isolatedDatabase();
  app = await bootApp(
    {},
    {
      DATABASE_URL: databaseUrl,
      SURGE_INTERVAL_MS: 60_000,
      SURGE_SLOPE_BP: 2_000,
      SURGE_CAP_BP: 15_000,
      SURGE_MAX_STEP_BP: 500,
    },
  );
  await app.init();
});
afterAll(() => app.close());
// Each test starts with no stored surge and no ride in the 60 s window, so its cells are its own.
beforeEach(async () => {
  await redis().del(key('moto'), key('remork'), key('bajaj'));
  await db().query(`UPDATE rides SET created_at = now() - interval '2 minutes'`);
});

const report = (driver: Actor, p: Point) =>
  http()
    .post('/drivers/me/locations')
    .set(driver.auth)
    .send({ points: [{ ...p, recordedAt: new Date().toISOString() }] })
    .expect(200);
const online = (driver: Actor) => http().put('/drivers/me/availability').set(driver.auth).send({ online: true }).expect(200);
// Verified, freshly located and online: exactly what counts as one unit of supply
const driver = async (vehicleType: VehicleType, p: Point) => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType, plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  const verified = await signIn(app, me.phone); // a fresh token carries the driver role
  await report(verified, p);
  await online(verified);
  return verified;
};
const book = async (rider: Actor, p: Point, vehicleType: VehicleType = 'remork') => {
  const trip = { pickup: p, dropoff: { lat: p.lat - 0.01, lng: p.lng }, vehicleType };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};

it('stores the smoothed multiplier for a cell: 3 riders to 1 remork is target 14000, so one run stores 10500', async () => {
  const p = { lat: 11.5564, lng: 104.88 };
  for (let i = 0; i < 3; i++) await book(await signIn(app), p);
  await driver('remork', p);

  await surge().run();

  // target = 10000 + 2000 × (3 − 1) / 1 = 14000; the first run may only move 500 from 10000
  expect(await valueAt(p)).toBe('10500');
});

it('smooths from the stored value: a second run moves at most 500 bp further', async () => {
  const p = { lat: 11.575, lng: 104.88 };
  for (let i = 0; i < 3; i++) await book(await signIn(app), p);
  await driver('remork', p);

  await surge().run();
  expect(await valueAt(p)).toBe('10500');
  await surge().run();
  expect(await valueAt(p)).toBe('11000'); // still toward 14000
});

it('decays by 500 bp per run once the demand ages out, and drops the field at 10000', async () => {
  const p = { lat: 11.538, lng: 104.88 };
  const ride = await book(await signIn(app), p);
  for (let i = 0; i < 3; i++) await surge().run();
  expect(await valueAt(p)).toBe('11500'); // target without supply is 12000

  await db().query(`UPDATE rides SET created_at = now() - interval '2 minutes' WHERE id = $1`, [ride.id]);

  await surge().run();
  expect(await valueAt(p)).toBe('11000');
  await surge().run();
  expect(await valueAt(p)).toBe('10500');
  await surge().run();
  expect(await valueAt(p)).toBeUndefined(); // 1.0x is not stored
});

it('counts only one verified, available, fresh remork driver, and only remork rides, as demand', async () => {
  const p = { lat: 11.538, lng: 104.95 };
  for (let i = 0; i < 3; i++) await book(await signIn(app), p);
  await book(await signIn(app), p, 'moto'); // another type's ride is not remork demand

  await driver('remork', p);
  const stale = await driver('remork', p);
  const unverified = await driver('remork', p);
  const offline = await driver('remork', p);
  await driver('bajaj', p);
  await db().query(`UPDATE driver_locations SET received_at = now() - interval '61 seconds' WHERE driver_id = $1`, [stale.id]);
  await db().query(`UPDATE drivers SET verification = 'pending' WHERE user_id = $1`, [unverified.id]);
  await db().query(`UPDATE drivers SET availability = 'offline' WHERE user_id = $1`, [offline.id]);

  for (let i = 0; i < 8; i++) await surge().run();

  // demand 3, supply 1 → target = 10000 + 2000 × 2 = 14000; a counted extra supply or demand would land elsewhere
  expect(await valueAt(p)).toBe('14000');
});

it('stores nothing for a cell with supply only', async () => {
  const p = { lat: 11.52, lng: 104.95 };
  await driver('remork', p);
  await driver('bajaj', p);

  await surge().run();

  expect(await valueAt(p)).toBeUndefined();
  expect(await valueAt(p, 'bajaj')).toBeUndefined();
});

it('counts one rider once when they cancel and request again', async () => {
  const p = { lat: 11.575, lng: 104.98 };
  const rider = await signIn(app);
  const first = await book(rider, p);
  await http().post(`/rides/${first.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await book(rider, p);
  await driver('remork', p);

  await surge().run();

  // demand 1, supply 1 → 1.0x, so nothing is stored; counting both rides would store 10500
  expect(await valueAt(p)).toBeUndefined();
});

it('uses the newest pickup when a rider cancels and rebooks in another cell', async () => {
  const [a, b] = [
    { lat: 11.52, lng: 104.88 },
    { lat: 11.52, lng: 104.9 }, // ~2 km east, a different cell
  ];
  const rider = await signIn(app);
  const first = await book(rider, a);
  await http().post(`/rides/${first.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await book(rider, b);

  await surge().run();

  // one rider, newest pickup at b, no supply → target 12000, so one run stores 10500 at b only
  expect(await valueAt(b)).toBe('10500');
  expect(await valueAt(a)).toBeUndefined();
});

it('counts a rider once per vehicle type when they hold rides of two types', async () => {
  const [remorkAt, motoAt] = [
    { lat: 11.575, lng: 104.9 },
    { lat: 11.593, lng: 104.9 }, // ~2 km north, a different cell
  ];
  const rider = await signIn(app);
  const first = await book(rider, remorkAt);
  await http().post(`/rides/${first.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await book(rider, motoAt, 'moto');

  await surge().run();

  // one rider, one ride of each type, no supply → target 12000 for both; one run stores 10500 in each hash
  expect(await valueAt(remorkAt)).toBe('10500');
  expect(await valueAt(motoAt, 'moto')).toBe('10500');
});

it('expires a stored value after 3 × SURGE_INTERVAL_MS', async () => {
  const p = { lat: 11.5564, lng: 104.9282 };
  await book(await signIn(app), p);
  await book(await signIn(app), p);

  await surge().run();

  expect(await valueAt(p)).toBe('10500');
  const ttl = await redis().pttl(key('remork'));
  expect(ttl).toBeGreaterThan(170_000);
  expect(ttl).toBeLessThanOrEqual(180_000);
});

it('keeps pickups in different res-8 cells under separate fields', async () => {
  const [a, b] = [
    { lat: 11.5564, lng: 104.9282 },
    { lat: 11.575, lng: 104.9282 }, // ~2 km north, a different cell
  ];
  await book(await signIn(app), a);
  await book(await signIn(app), b);

  await surge().run();

  const fields = await redis().hgetall(key('remork'));
  expect(fields[cell(a)]).toBe('10500');
  expect(fields[cell(b)]).toBe('10500');
});
