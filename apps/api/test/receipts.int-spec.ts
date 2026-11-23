import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PRICING_CONFIG, type PricingConfig } from '../src/pricing/pricing.config';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { assign } from './support/offers';

// PLAN.md M6.12: a completed ride's receipt, built from the snapshots booking and completion stored. Same quote as
// commission.int-spec: trip 9500 + surge 4800 + fee 500 = 14 800 riel, commission 2300, so the driver earns 12 500.
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };
const card = `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
              VALUES ('moto', 5000, 1700, 300, 0, 500, $1, now() + $2::interval)`;

let app: INestApplication<App>;
let surgeKey: string;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const setSurge = (bp: string) => app.get(Redis).hset(surgeKey, latLngToCell(trip.pickup.lat, trip.pickup.lng, 8), bp);

beforeAll(async () => {
  const DATABASE_URL = await isolatedDatabase(); // own database: the cards below would re-price other suites' quotes
  app = await (await bootApp({}, { DATABASE_URL })).init();
  await db().query(card, [1200, '-1 minute']);
  surgeKey = `${app.get<PricingConfig>(PRICING_CONFIG).QUEUE_PREFIX}:surge:moto`;
  await setSurge('15000');
});
afterAll(() => app.close());

const receipt = (a: Actor, rideId: string) => http().get(`/rides/${rideId}/receipt`).set(a.auth);
const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const newDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'moto', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const searchingRide = async (rider?: Actor): Promise<{ rider: Actor; ride: Ride }> => {
  const r = rider ?? (await signIn(app));
  const quote = (await http().post('/quotes').set(r.auth).send(trip).expect(201)).body as Quote;
  const ride = (await http().post('/rides').set(r.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  return { rider: r, ride };
};
// A ride accepted by the driver and walked on with the driver's steps
const rideFor = async (driver: Actor, ...steps: string[]) => {
  const { rider, ride } = await searchingRide();
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return { rider, driver, ride };
};
const completedRide = async () => rideFor(await newDriver(), 'arrive', 'start', 'complete');
const money = (amountMinor: number) => ({ amountMinor, currency: 'KHR' });

describe('GET /rides/:id/receipt', () => {
  it('gives the rider the fare lines and total, and never the commission', async () => {
    const { rider, ride } = await completedRide();
    const res = await receipt(rider, ride.id);
    expect(res.status).toBe(HttpStatus.OK);
    const [q] = await db().query<{ distance_m: number; duration_s: number }[]>(
      'SELECT q.distance_m, q.duration_s FROM quotes q JOIN rides r ON r.quote_id = q.id WHERE r.id = $1',
      [ride.id],
    );
    const [done] = await db().query<{ created_at: Date }[]>(
      `SELECT created_at FROM ride_events WHERE ride_id = $1 AND status = 'completed'`,
      [ride.id],
    );
    expect(res.body).toEqual({
      rideId: ride.id,
      vehicleType: 'moto',
      pickup: trip.pickup,
      dropoff: trip.dropoff,
      completedAt: done.created_at.toISOString(),
      distanceM: q.distance_m,
      durationS: q.duration_s,
      surgeBp: 15000,
      lines: { trip: money(9500), surge: money(4800), bookingFee: money(500) },
      total: money(14800),
      driver: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/commission|2300/i);
  });

  it('gives the driver the same lines plus the commission and their earnings', async () => {
    const { driver, ride } = await completedRide();
    const res = await receipt(driver, ride.id);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({
      rideId: ride.id,
      lines: { trip: money(9500), surge: money(4800), bookingFee: money(500) },
      total: money(14800),
      driver: { commission: money(2300), earnings: money(12500) },
    });
  });

  it('answers 404 to a stranger and to an unknown ride, with no receipt data, and 401 without a token', async () => {
    const { ride } = await completedRide();
    const stranger = await signIn(app);
    for (const res of [await receipt(stranger, ride.id), await receipt(stranger, randomUUID())]) {
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
      expect(res.body).toMatchObject({ message: 'Ride not found' });
      expect(res.body).not.toHaveProperty('lines');
    }
    expect((await http().get(`/rides/${ride.id}/receipt`)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('answers 400 to a ride id that is not a uuid', async () => {
    const rider = await signIn(app);
    expect((await receipt(rider, 'not-a-uuid')).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('refuses a ride that is not completed, to its rider or its driver, with the same 409 body', async () => {
    const { rider, ride } = await searchingRide();
    const res = await receipt(rider, ride.id);
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toEqual({ statusCode: 409, code: 'RIDE_NOT_COMPLETED', message: 'Only a completed ride has a receipt' });

    const inProgress = await rideFor(await newDriver(), 'arrive', 'start');
    expect((await receipt(inProgress.driver, inProgress.ride.id)).body).toEqual(res.body);

    const cancelled = await searchingRide();
    await http().post(`/rides/${cancelled.ride.id}/cancel`).set(cancelled.rider.auth).send({ reason: 'changed_mind' }).expect(200);
    expect((await receipt(cancelled.rider, cancelled.ride.id)).body).toEqual(res.body);
  });

  // Last: the card and surge changes below would re-price the quotes of the tests above
  it('builds the receipt from the stored snapshots, not from the current rate card or surge', async () => {
    const { rider, driver, ride } = await completedRide();
    const before = await receipt(rider, ride.id);
    const beforeDriver = await receipt(driver, ride.id);
    expect(before.status).toBe(HttpStatus.OK); // two identical 404s would compare equal
    // Other prices than the quoted card, so a receipt that read a current price would change
    await db().query(
      `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
       VALUES ('moto', 9000, 2000, 400, 0, 800, 2000, now())`,
    );
    await setSurge('20000');
    expect((await receipt(rider, ride.id)).text).toBe(before.text);
    expect((await receipt(driver, ride.id)).text).toBe(beforeDriver.text);
  });
});
