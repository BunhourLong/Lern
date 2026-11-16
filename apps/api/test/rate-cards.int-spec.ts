import type { Quote } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

let app: INestApplication<App>;
const db = () => app.get(DataSource);

// Own database: a newer moto card in the shared one would re-price every other suite's quotes
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
});
afterAll(() => app.close());

// Independence Monument → Phnom Penh airport, ~9.1 km straight line
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 } };
const quote = async (rider: Actor, vehicleType: string) =>
  (await request(app.getHttpServer()).post('/quotes').set(rider.auth).send({ ...trip, vehicleType }).expect(201)).body as Quote;
const cardOf = async (q: Quote) =>
  (await db().query<{ rate_card_id: string }[]>('SELECT rate_card_id FROM quotes WHERE id = $1', [q.id]))[0].rate_card_id;
const addCard = async (startsIn: string, minimumFare: number, base = 5000) =>
  (
    await db().query<{ id: string }[]>(
      `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from)
       VALUES ('moto', $1, 1700, 300, $2, 500, now() + $3::interval) RETURNING id`,
      [base, minimumFare, startsIn],
    )
  )[0];

let current: { id: string };
let future: { id: string };

it('prices a quote with the newest card already active for its vehicle type, and stores that card', async () => {
  current = await addCard('-1 minute', 60_000);
  future = await addCard('1 hour', 900_000);
  const rider = await signIn(app);

  const moto = await quote(rider, 'moto');
  // card A: 5000 + 1700/km over ~9.1 km ≈ 20 500 < minimum 60 000, plus the 500 booking fee
  expect(moto.fare).toEqual({ amountMinor: 60_500, currency: 'KHR' });
  expect(await cardOf(moto)).toBe(current.id);

  // No newer bajaj card: the seeded one, at the pre-M6 price (3000 + 1300 riel/km, up to the next 100)
  const bajaj = await quote(rider, 'bajaj');
  const [seeded] = await db().query<{ id: string }[]>(`SELECT id FROM rate_cards WHERE vehicle_type = 'bajaj'`);
  expect(bajaj.fare.amountMinor).toBe(Math.ceil((3_000_000 + 1300 * bajaj.distanceM) / 100_000) * 100);
  expect(await cardOf(bajaj)).toBe(seeded.id);
});

it('keeps cards append-only: no update, no delete, no second card for the same type and start, no negative price', async () => {
  await expect(db().query('UPDATE rate_cards SET base = base + 1 WHERE id = $1', [future.id])).rejects.toThrow(/append-only/);
  await expect(db().query('DELETE FROM rate_cards WHERE id = $1', [future.id])).rejects.toThrow(/append-only/);
  // active_from copied in SQL: a JS Date would drop the microseconds and miss the tie
  const tie = `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from)
               SELECT vehicle_type, 0, 0, 0, 0, 0, active_from FROM rate_cards WHERE id = $1`;
  await expect(db().query(tie, [current.id])).rejects.toMatchObject({ code: '23505' });
  await expect(addCard('2 hours', 0, -1)).rejects.toMatchObject({ code: '23514' });
});
