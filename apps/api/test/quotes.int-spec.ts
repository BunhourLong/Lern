import type { Quote } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { fare } from '../src/pricing/domain/fare';
import { type Actor, bootApp, signIn } from './support/actors';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Independence Monument → Phnom Penh airport, ~9.1 km straight line
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'moto' };
const quote = (a: Actor, body: object = trip) => http().post('/quotes').set(a.auth).send(body);
const stored = (a: Actor) =>
  db().query<{ amount_minor: string; pickup_lat: number; pickup_lng: number; ttl_s: number }[]>(
    `SELECT amount_minor, ST_Y(pickup::geometry) AS pickup_lat, ST_X(pickup::geometry) AS pickup_lng,
            EXTRACT(EPOCH FROM expires_at - created_at)::int AS ttl_s
     FROM quotes WHERE rider_id = $1`,
    [a.id],
  );

beforeAll(async () => {
  app = await (await bootApp()).init();
});

afterAll(() => app.close());

describe('POST /quotes', () => {
  it('prices the trip in riel, stores it for the caller, and expires it 5 minutes later by server time', async () => {
    const rider = await signIn(app);
    const res = await quote(rider);
    expect(res.status).toBe(HttpStatus.CREATED);
    const body = res.body as Quote;
    // id and expiresAt formats are checked by the response serializer against the contract
    expect(body).toMatchObject({ vehicleType: 'moto', fare: fare('moto', body.distanceM) });
    expect(body.distanceM).toBeGreaterThan(9_000);
    expect(body.distanceM).toBeLessThan(9_300);

    const [row] = await stored(rider);
    expect(row).toEqual({ amount_minor: String(body.fare.amountMinor), pickup_lat: 11.5564, pickup_lng: 104.9282, ttl_s: 300 });
  });

  it('ignores a rider id or price sent by the client', async () => {
    const [a, b] = [await signIn(app), await signIn(app)];
    const res = await quote(b, { ...trip, riderId: a.id, fare: { amountMinor: 1, currency: 'KHR' } });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect((res.body as Quote).fare.amountMinor).toBeGreaterThan(1);
    expect(await stored(a)).toEqual([]);
    expect(await stored(b)).toHaveLength(1);
  });

  it('is 400 for a point outside Cambodia, an unknown vehicle or a missing dropoff, and stores nothing', async () => {
    const rider = await signIn(app);
    const bangkok = { lat: 13.75, lng: 100.5 };
    for (const body of [
      { ...trip, dropoff: bangkok },
      { ...trip, vehicleType: 'car' },
      { pickup: trip.pickup, vehicleType: 'moto' },
    ]) {
      expect((await quote(rider, body)).status).toBe(HttpStatus.BAD_REQUEST);
    }
    expect(await stored(rider)).toEqual([]);
  });

  it('is 401 without a token and 403 for a user without the rider role', async () => {
    expect((await http().post('/quotes').send(trip)).status).toBe(HttpStatus.UNAUTHORIZED);

    const user = await signIn(app);
    await db().query('DELETE FROM user_roles WHERE user_id = $1', [user.id]);
    const res = await http().post('/auth/refresh').send({ refreshToken: user.tokens.refreshToken });
    const roleless = { ...user, auth: { authorization: `Bearer ${(res.body as { accessToken: string }).accessToken}` } };
    expect((await quote(roleless)).status).toBe(HttpStatus.FORBIDDEN);
  });
});
