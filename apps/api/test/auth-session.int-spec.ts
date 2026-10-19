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
