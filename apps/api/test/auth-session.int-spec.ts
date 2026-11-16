import type { INestApplication } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { bootApp, signIn, uniquePhone } from './support/actors';

type Tokens = { accessToken: string; refreshToken: string };

let app: INestApplication<App>;
const verify = (body: object) => request(app.getHttpServer()).post('/auth/otp/verify').send(body);
const refresh = (refreshToken: string) => request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });
const logout = (refreshToken: string) => request(app.getHttpServer()).post('/auth/logout').send({ refreshToken });
const login = async (to?: string) => (await signIn(app, to)).tokens;
const userId = (tokens: Tokens) => app.get(JwtService).verify<{ sub: string }>(tokens.accessToken).sub;

beforeAll(async () => {
  app = await (await bootApp()).init();
});

afterAll(() => app.close());

describe('POST /auth/otp/verify', () => {
  it('returns an access token for the phone owner and a refresh token', async () => {
    const tokens = await login();
    expect(typeof userId(tokens)).toBe('string');
    expect(tokens.refreshToken).toMatch(/^[\w-]{43}$/);
  });

  it('logs the same number into the same user, even when two first logins race', async () => {
    const to = await uniquePhone(app);
    const [a, b] = await Promise.all([login(to), login(to)]);
    expect(userId(a)).toBe(userId(b));
    expect(userId(await login(to))).toBe(userId(a));
  });

  it('is 401 for a wrong code and 400 for a malformed one', async () => {
    expect((await verify({ phone: await uniquePhone(app), code: '123456' })).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await verify({ phone: await uniquePhone(app), code: '12345' })).status).toBe(HttpStatus.BAD_REQUEST);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: returns a new pair for the same user and the old refresh token stops working', async () => {
    const first = await login();
    const res = await refresh(first.refreshToken);
    expect(res.status).toBe(HttpStatus.OK);
    const second = res.body as Tokens;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(userId(second)).toBe(userId(first));
    expect((await refresh(second.refreshToken)).status).toBe(HttpStatus.OK);
  });

  it('treats reuse of a rotated token as theft: revokes the whole family but not other logins', async () => {
    const stolen = await login();
    const otherDevice = await login();
    const current = (await refresh(stolen.refreshToken).expect(200)).body as Tokens;

    expect((await refresh(stolen.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await refresh(current.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await refresh(otherDevice.refreshToken)).status).toBe(HttpStatus.OK);
  });

  it('lets exactly one of two parallel refreshes win, and the loser revokes the family', async () => {
    const tokens = await login();
    const results = await Promise.all([refresh(tokens.refreshToken), refresh(tokens.refreshToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([HttpStatus.OK, HttpStatus.UNAUTHORIZED]);
    const winner = results.find((r) => r.ok)!.body as Tokens;
    expect((await refresh(winner.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('is 401 for an expired or unknown token', async () => {
    const tokens = await login();
    const hash = createHash('sha256').update(tokens.refreshToken).digest('hex');
    await app
      .get(DataSource)
      .query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [hash]);
    expect((await refresh(tokens.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await refresh('x'.repeat(43))).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await refresh('')).status).toBe(HttpStatus.BAD_REQUEST);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the whole family: the family’s current token stops refreshing after logout', async () => {
    const first = await login();
    const current = (await refresh(first.refreshToken).expect(HttpStatus.OK)).body as Tokens;
    expect((await logout(current.refreshToken)).status).toBe(HttpStatus.NO_CONTENT);
    expect((await refresh(current.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('answers 204 on repeat and for unknown tokens, without touching other families', async () => {
    const mine = await login();
    const other = await login();
    expect((await logout(mine.refreshToken)).status).toBe(HttpStatus.NO_CONTENT);
    expect((await logout(mine.refreshToken)).status).toBe(HttpStatus.NO_CONTENT);
    expect((await logout('y'.repeat(43))).status).toBe(HttpStatus.NO_CONTENT);
    expect((await refresh(other.refreshToken)).status).toBe(HttpStatus.OK);
  });

  it('logs out one device of one user: the same user’s other device stays live', async () => {
    const to = await uniquePhone(app);
    const deviceA = await login(to);
    const deviceB = await login(to);
    expect((await logout(deviceA.refreshToken)).status).toBe(HttpStatus.NO_CONTENT);
    expect((await refresh(deviceB.refreshToken)).status).toBe(HttpStatus.OK);
  });

  it('revokes the family even when the presented token is an old, already-rotated one', async () => {
    const first = await login();
    const current = (await refresh(first.refreshToken).expect(HttpStatus.OK)).body as Tokens;
    expect((await logout(first.refreshToken)).status).toBe(HttpStatus.NO_CONTENT);
    expect((await refresh(current.refreshToken)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  // A refresh in flight, uncommitted, mimicking SessionsService.refresh: it takes the family lock,
  // claims a live row (row lock) and inserts its rotation. Logout must block on the family lock and
  // re-check after the commit: no statement snapshot can see the rotated token, because the row
  // postdates it (supertest dispatches on .then, so the request starts now, not when awaited)
  const inFlightRefresh = async (ds: DataSource, liveHash: string, rotatedToken: string) => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(
           (SELECT family_id::text FROM refresh_tokens WHERE token_hash = $1), 0))`,
        [liveHash],
      );
      await runner.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [liveHash],
      );
      await runner.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         SELECT user_id, family_id, $1, now() + interval '30 days' FROM refresh_tokens WHERE token_hash = $2`,
        [createHash('sha256').update(rotatedToken).digest('hex'), liveHash],
      );
      return runner;
    } catch (error) {
      await runner.release();
      throw error;
    }
  };
  const waitLocked = async (ds: DataSource) => {
    for (const end = Date.now() + 10_000; ; ) {
      const [{ waiting }] = await ds.query<{ waiting: number }[]>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`,
      );
      if (waiting === 1) return;
      if (Date.now() > end) throw new Error('logout never arrived at the family lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const racesLogout = async (
    presentToken: string,
    liveHash: string,
    rotatedToken: string,
  ): Promise<void> => {
    const ds = app.get(DataSource);
    const runner = await inFlightRefresh(ds, liveHash, rotatedToken);
    try {
      const pendingLogout = logout(presentToken).then((r) => r.status);
      await waitLocked(ds);
      await runner.commitTransaction();
      expect(await pendingLogout).toBe(HttpStatus.NO_CONTENT);
      expect((await refresh(rotatedToken)).status).toBe(HttpStatus.UNAUTHORIZED);
    } finally {
      await runner.release();
    }
  };

  it(
    'revokes the token a concurrent refresh rotates: logout waits for the family lock, then re-checks',
    async () => {
      const tokens = await login();
      return racesLogout(
        tokens.refreshToken,
        createHash('sha256').update(tokens.refreshToken).digest('hex'),
        'r'.repeat(43),
      );
    },
    15_000,
  );

  it(
    'revokes the family even when the presented token is an old row and a refresh of its live row is in flight',
    async () => {
      const first = await login();
      const current = (await refresh(first.refreshToken).expect(HttpStatus.OK)).body as Tokens;
      return racesLogout(
        first.refreshToken,
        createHash('sha256').update(current.refreshToken).digest('hex'),
        'q'.repeat(43),
      );
    },
    15_000,
  );

  it('is 400 for a malformed body', async () => {
    expect((await logout('short')).status).toBe(HttpStatus.BAD_REQUEST);
  });
});
