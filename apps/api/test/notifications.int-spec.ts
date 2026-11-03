import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

const put = (a: Actor, body: object) => http().put('/me/device-token').set(a.auth).send(body);
const newToken = () => `fcm-${randomUUID()}`;
const tokensOf = async (a: Actor) =>
  (await db().query<{ token: string }[]>('SELECT token FROM device_tokens WHERE user_id = $1 ORDER BY updated_at', [a.id])).map(
    (r) => r.token,
  );

beforeAll(async () => {
  app = await bootApp();
  await app.init();
});
afterAll(() => app.close());

it('needs a signed-in user', async () => {
  await http().put('/me/device-token').send({ token: newToken(), platform: 'android' }).expect(401);
});

it('registers a token for the caller', async () => {
  const me = await signIn(app);
  const token = newToken();
  await put(me, { token, platform: 'android' }).expect(204);
  expect(await tokensOf(me)).toEqual([token]);
});

it.each([
  ['an empty token', { token: '', platform: 'android' }],
  ['a token past the limit', { token: 'x'.repeat(4097), platform: 'android' }],
  ['an unknown platform', { token: 'abc', platform: 'web' }],
  ['no platform', { token: 'abc' }],
])('rejects %s and stores nothing', async (_, body) => {
  const me = await signIn(app);
  await put(me, body).expect(400);
  expect(await tokensOf(me)).toEqual([]);
});

it('ignores an owner smuggled in the body', async () => {
  const [me, victim] = [await signIn(app), await signIn(app)];
  const token = newToken();
  await put(me, { token, platform: 'ios', userId: victim.id, user_id: victim.id }).expect(204);
  expect(await tokensOf(me)).toEqual([token]);
  expect(await tokensOf(victim)).toEqual([]);
});

it('keeps one row when the same user registers the same token again', async () => {
  const me = await signIn(app);
  const token = newToken();
  await put(me, { token, platform: 'android' }).expect(204);
  await put(me, { token, platform: 'android' }).expect(204);
  expect(await tokensOf(me)).toEqual([token]);
});

it('moves a token to whoever signs in on that phone, so the previous user gets nothing on it', async () => {
  const [first, second] = [await signIn(app), await signIn(app)];
  const token = newToken();
  await put(first, { token, platform: 'android' }).expect(204);
  await put(second, { token, platform: 'android' }).expect(204);
  expect(await tokensOf(first)).toEqual([]);
  expect(await tokensOf(second)).toEqual([token]);
});

it('keeps only the newest 5 tokens per user, so one account cannot grow the fan-out', async () => {
  const me = await signIn(app);
  const tokens = [newToken(), newToken(), newToken(), newToken(), newToken(), newToken()];
  for (const token of tokens) await put(me, { token, platform: 'android' }).expect(204);
  expect(await tokensOf(me)).toEqual(tokens.slice(1));
});

it('replays a retried registration with the same Idempotency-Key', async () => {
  const me = await signIn(app);
  const [token, key] = [newToken(), randomUUID()];
  const send = () => put(me, { token, platform: 'android' }).set('Idempotency-Key', key);
  await send().expect(204);
  await send().expect(204);
  expect(await tokensOf(me)).toEqual([token]);
  // The same key on another body is a client bug, not a retry
  await put(me, { token: newToken(), platform: 'android' }).set('Idempotency-Key', key).expect(422);
});

it('counts a re-registered token as new, so a phone in use is not the one trimmed', async () => {
  const me = await signIn(app);
  const tokens = [newToken(), newToken(), newToken(), newToken(), newToken()];
  for (const token of tokens) await put(me, { token, platform: 'android' }).expect(204);
  await put(me, { token: tokens[0], platform: 'android' }).expect(204);
  const added = newToken();
  await put(me, { token: added, platform: 'android' }).expect(204);
  expect(await tokensOf(me)).toEqual([...tokens.slice(2), tokens[0], added]);
});

it('never trims a token another user took over while the trim waited for it', async () => {
  const [me, other] = [await signIn(app), await signIn(app)];
  const oldest = newToken();
  await put(me, { token: oldest, platform: 'android' }).expect(204);
  for (let i = 0; i < 4; i++) await put(me, { token: newToken(), platform: 'android' }).expect(204);

  // The takeover holds the row; the trim of `me` selects it, then waits for that lock
  const takeover = db().createQueryRunner();
  await takeover.connect();
  await takeover.startTransaction();
  await takeover.query('UPDATE device_tokens SET user_id = $1, updated_at = now() WHERE token = $2', [other.id, oldest]);
  const trim = put(me, { token: newToken(), platform: 'android' }).then((r) => r.status);
  for (let waiting = 0; waiting === 0; ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    [{ waiting }] = await db().query<{ waiting: number }[]>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%DELETE FROM device_tokens%'`,
    );
  }
  await takeover.commitTransaction();
  await takeover.release();

  expect(await trim).toBe(204);
  expect(await tokensOf(other)).toEqual([oldest]);
});
