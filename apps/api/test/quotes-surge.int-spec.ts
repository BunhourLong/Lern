import type { Point, Quote, VehicleType } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PRICING_CONFIG, type PricingConfig } from '../src/pricing/pricing.config';
import { bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

// PLAN.md M6.6: a quote multiplies its trip by the surge cached at the pickup's H3 res-8 cell (M6.5's hash) and
// stores the multiplier and the receipt lines. OSRM is down (test default), so the trip is the straight line:
// Independence Monument → Wat Phnom area, 1664 m, 333 s at 5 m/s.
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };
// Trip part: 5000 + 1664 × 1.7 + 333 × 5 = 9493.8 riel → 9500. The 500 fee is never surged.
const card = { base: 5000, perKm: 1700, perMin: 300, minimumFare: 0, bookingFee: 500 };

let app: INestApplication<App>;
const db = () => app.get(DataSource);
const redis = () => app.get(Redis);
const key = (vehicleType: VehicleType) => `${app.get<PricingConfig>(PRICING_CONFIG).QUEUE_PREFIX}:surge:${vehicleType}`;
const cell = (p: Point) => latLngToCell(p.lat, p.lng, 8);
const storeSurge = (vehicleType: VehicleType, p: Point, bp: string) => redis().hset(key(vehicleType), cell(p), bp);

beforeAll(async () => {
  const DATABASE_URL = await isolatedDatabase(); // own database: the card below would re-price other suites' quotes
  app = await (await bootApp({}, { DATABASE_URL, SURGE_CAP_BP: 20_000 })).init();
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', $1, $2, $3, $4, $5, 1500, now() - interval '1 minute')`,
    [card.base, card.perKm, card.perMin, card.minimumFare, card.bookingFee],
  );
});
beforeEach(() => redis().del(key('moto'), key('remork')));
afterAll(() => app.close());

const quote = async () => {
  const rider = await signIn(app);
  const q = (await request(app.getHttpServer()).post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  const [row] = await db().query<{ amount_minor: string; surge_bp: number; breakdown: unknown }[]>(
    'SELECT amount_minor, surge_bp, breakdown FROM quotes WHERE id = $1',
    [q.id],
  );
  return { q, row };
};
const unsurged = {
  amountMinor: 10_000,
  row: { amount_minor: '10000', surge_bp: 10_000, breakdown: { tripMinor: 9500, surgeMinor: 0, bookingFeeMinor: 500 } },
};

it('applies the surge cached at the pickup cell and snapshots it with the receipt lines', async () => {
  await storeSurge('moto', trip.pickup, '15000');
  const { q, row } = await quote();
  // 9493.8 × 1.5 = 14240.7 → 14300, so the surge line is 4800
  expect(q.fare).toEqual({ amountMinor: 14_800, currency: 'KHR' });
  expect(row).toEqual({ amount_minor: '14800', surge_bp: 15_000, breakdown: { tripMinor: 9500, surgeMinor: 4800, bookingFeeMinor: 500 } });
});

it.each<[string, () => Promise<unknown>]>([
  ['no surge is cached', async () => {}],
  ['only the dropoff cell surges', () => storeSurge('moto', trip.dropoff, '15000')],
  ['only another vehicle type surges at the pickup', () => storeSurge('remork', trip.pickup, '15000')],
  ['the cached value is not a number', () => storeSurge('moto', trip.pickup, 'abc')],
  ['the cached value is below 1.0x', () => storeSurge('moto', trip.pickup, '9000')],
  // fare() refuses a fractional multiplier: passed through, the quote would fail with a 500
  ['the cached value is fractional', () => storeSurge('moto', trip.pickup, '15000.5')],
  // Number() rounds this to 15000: only an exact integer string is a multiplier
  ['the cached value only rounds to an integer', () => storeSurge('moto', trip.pickup, '15000.0000000000001')],
])('prices at 1.0x when %s', async (_, setup) => {
  await setup();
  const { q, row } = await quote();
  expect(q.fare.amountMinor).toBe(unsurged.amountMinor);
  expect(row).toEqual(unsurged.row);
});

it('clamps a cached value above SURGE_CAP_BP to the cap', async () => {
  await storeSurge('moto', trip.pickup, '30000');
  const { q, row } = await quote();
  // 9493.8 × 2.0 = 18987.6 → 19000
  expect(q.fare.amountMinor).toBe(19_500);
  expect(row).toEqual({ amount_minor: '19500', surge_bp: 20_000, breakdown: { tripMinor: 9500, surgeMinor: 9500, bookingFeeMinor: 500 } });
});

it('refuses a rate card whose booking fee is not a whole 100 riel', async () => {
  await expect(
    db().query(
      `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
       VALUES ('bajaj', 0, 0, 0, 0, 50, 1500, now() + interval '1 day')`,
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('refuses a quote row without its surge snapshot, or below 1.0x', async () => {
  const { q } = await quote();
  // Copy a real row, so only the column under test can make the insert fail
  const copy = (columns: string, values: string) =>
    db().query(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, rate_card_id, expires_at${columns})
       SELECT rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, rate_card_id, expires_at${values}
       FROM quotes WHERE id = $1`,
      [q.id],
    );
  await expect(copy(', surge_bp, breakdown', ', surge_bp, breakdown')).resolves.toBeDefined();
  await expect(copy(', breakdown', ', breakdown')).rejects.toMatchObject({ code: '23502', column: 'surge_bp' });
  await expect(copy(', surge_bp', ', surge_bp')).rejects.toMatchObject({ code: '23502', column: 'breakdown' });
  await expect(copy(', surge_bp, breakdown', ', 9999, breakdown')).rejects.toMatchObject({ code: '23514' });
});
