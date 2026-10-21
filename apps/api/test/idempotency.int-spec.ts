import type { Quote, TokenPair } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'moto' };
const newQuote = async (a: Actor) => (await http().post('/quotes').set(a.auth).send(trip).expect(201)).body as Quote;
const book = (a: Actor, quoteId: string, key: string) =>
  http().post('/rides').set(a.auth).set('Idempotency-Key', key).send({ quoteId });
const rideCount = async (a: Actor) =>
  (await db().query<{ n: number }[]>('SELECT count(*)::int AS n FROM rides WHERE rider_id = $1', [a.id]))[0].n;
const refresh = (refreshToken: string, key?: string) => {
  const req = http().post('/auth/refresh');
  if (key) void req.set('Idempotency-Key', key);
  return req.send({ refreshToken });
};

beforeAll(async () => {
  app = await (await bootApp()).init();
});

afterAll(() => app.close());

describe('Idempotency-Key on POST /rides', () => {
  it('replays the original response for a retry, without booking again', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    const key = randomUUID();
    const first = await book(rider, quote.id, key);
    const retry = await book(rider, quote.id, key);
    expect(first.status).toBe(HttpStatus.CREATED);
    expect(retry.status).toBe(HttpStatus.CREATED);
    expect(retry.body).toEqual(first.body);
    expect(await rideCount(rider)).toBe(1);
  });

  it('books once when the same key arrives twice in parallel', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    const key = randomUUID();
    const res = await Promise.all([book(rider, quote.id, key), book(rider, quote.id, key)]);
    // The loser either sees the request in progress (409) or, if it was late, the replay (201)
    expect(res.map((r) => r.status)).toContain(HttpStatus.CREATED);
    for (const r of res) expect([HttpStatus.CREATED, HttpStatus.CONFLICT]).toContain(r.status);
    expect(await rideCount(rider)).toBe(1);
  });

  it('is 422 when a key is reused for a different request', async () => {
    const rider = await signIn(app);
    const [q1, q2] = [await newQuote(rider), await newQuote(rider)];
    const key = randomUUID();
    await book(rider, q1.id, key).expect(201);
    expect((await book(rider, q2.id, key)).status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('does not keep a failed request, so the key can be used once the problem is fixed', async () => {
    const rider = await signIn(app);
    const key = randomUUID();
    expect((await book(rider, 'not-a-uuid', key)).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await book(rider, randomUUID(), key)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await book(rider, (await newQuote(rider)).id, key)).status).toBe(HttpStatus.CREATED);
  });

  it('scopes keys per user', async () => {
    const [a, b] = [await signIn(app), await signIn(app)];
    const key = randomUUID();
    await book(a, (await newQuote(a)).id, key).expect(201);
    const res = await book(b, (await newQuote(b)).id, key);
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(await rideCount(b)).toBe(1);
  });

  it('is 400 for a key that is not a UUID', async () => {
    const rider = await signIn(app);
    expect((await book(rider, (await newQuote(rider)).id, 'abc')).status).toBe(HttpStatus.BAD_REQUEST);
    expect(await rideCount(rider)).toBe(0);
  });
});

describe('Idempotency-Key on POST /auth/refresh', () => {
  it('replays the rotated pair for a retry instead of treating it as token theft', async () => {
    const { tokens } = await signIn(app);
    const key = randomUUID();
    const first = await refresh(tokens.refreshToken, key);
    const retry = await refresh(tokens.refreshToken, key);
    expect(first.status).toBe(HttpStatus.OK);
    expect(retry.status).toBe(HttpStatus.OK);
    expect(retry.body).toEqual(first.body);
    // The family is still alive: the replayed refresh token rotates normally
    expect((await refresh((first.body as TokenPair).refreshToken)).status).toBe(HttpStatus.OK);
  });

  it('still revokes the family when the old token comes back without the key', async () => {
    const { tokens } = await signIn(app);
    const first = (await refresh(tokens.refreshToken, randomUUID()).expect(200)).body as TokenPair;
    expect((await refresh(tokens.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await refresh(first.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('never stores the issued tokens in readable form', async () => {
    const { tokens } = await signIn(app);
    const key = randomUUID();
    const pair = (await refresh(tokens.refreshToken, key).expect(200)).body as TokenPair;
    const [row] = await db().query<{ response: Buffer }[]>('SELECT response FROM idempotency_keys WHERE key = $1', [key]);
    expect(row.response.length).toBeGreaterThan(0);
    const raw = row.response.toString('latin1');
    expect(raw).not.toContain(pair.refreshToken);
    expect(raw).not.toContain(pair.accessToken.split('.')[1]);
  });
});

describe('Idempotency-Key on POST /drivers/me', () => {
  it('replays the 201 for a retried application instead of a 409', async () => {
    const user = await signIn(app);
    const key = randomUUID();
    const apply = () =>
      http().post('/drivers/me').set(user.auth).set('Idempotency-Key', key).send({ vehicleType: 'moto', plate: 'PP 1A-0001' });
    const first = await apply();
    const retry = await apply();
    expect([first.status, retry.status]).toEqual([HttpStatus.CREATED, HttpStatus.CREATED]);
    expect(retry.body).toEqual(first.body);
  });
});
