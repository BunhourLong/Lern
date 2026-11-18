import type { Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PRICING_CONFIG, type PricingConfig } from '../src/pricing/pricing.config';
import { bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

// PLAN.md M6.7: booking snapshots the platform's commission from the quote's own rate card (invariant 6).
// OSRM is down (test default), so the trip is the straight line used by quotes-surge: trip 9500 riel, and at 1.5x
// surge 4800, with the unsurged 500 fee: fare 14 800.
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };
const card = `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
              VALUES ('moto', 5000, 1700, 300, 0, 500, $1, now() + $2::interval)`;

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

beforeAll(async () => {
  const DATABASE_URL = await isolatedDatabase(); // own database: the cards below would re-price other suites' quotes
  app = await (await bootApp({}, { DATABASE_URL })).init();
  await db().query(card, [1200, '-1 minute']); // not the migration's 1500 seed, so a hard-coded rate shows
  const surgeKey = `${app.get<PricingConfig>(PRICING_CONFIG).QUEUE_PREFIX}:surge:moto`;
  await app.get(Redis).hset(surgeKey, latLngToCell(trip.pickup.lat, trip.pickup.lng, 8), '15000');
});
afterAll(() => app.close());

const quote = async () => {
  const rider = await signIn(app);
  const q = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  expect(q.fare).toEqual({ amountMinor: 14_800, currency: 'KHR' });
  return { rider, q };
};
const book = async ({ rider, q }: Awaited<ReturnType<typeof quote>>) => {
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: q.id }).expect(201)).body as Ride;
  const [row] = await db().query<{ fare_minor: string; commission_bp: number; commission_minor: string }[]>(
    'SELECT fare_minor, commission_bp, commission_minor FROM rides WHERE id = $1',
    [ride.id],
  );
  return { ride, row };
};
// (9500 + 4800) × 12% = 1716 → 1800, plus the whole 500 fee
const atBooking = { fare_minor: '14800', commission_bp: 1200, commission_minor: '2300' };

it('stores the rate and the commission of trip + surge, rounded up once, plus the whole booking fee', async () => {
  const { ride, row } = await book(await quote());
  expect(row).toEqual(atBooking);
  // Never in a client payload; outbox.int-spec compares each socket payload with the REST body, so this covers both
  expect(ride.fare).toEqual({ amountMinor: 14_800, currency: 'KHR' });
  expect(JSON.stringify(ride)).not.toMatch(/commission|2300/i);
});

it("keeps the quote's card rate when a newer card is active by booking time", async () => {
  const quoted = await quote();
  // 2000 bp would give 14 300 × 20% = 2860 → 2900 + 500 = 3400
  await db().query(card, [2000, '0 seconds']);
  expect((await book(quoted)).row).toEqual(atBooking);
});
