import type { INestApplication } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { OtpProvider } from '../src/auth/otp.provider';
import { OtpService } from '../src/auth/otp.service';
import { bootApp, uniquePhone } from './support/actors';

let app: INestApplication<App>;
let send: jest.SpyInstance;
const requestOtp = (body: object) => request(app.getHttpServer()).post('/auth/otp/request').send(body);

beforeAll(async () => {
  app = await (await bootApp()).init();
  send = jest.spyOn(app.get(OtpProvider), 'send');
});

beforeEach(async () => {
  send.mockClear();
  // All supertest requests share one IP; reset its window so tests stay independent
  const redis = app.get(Redis);
  const keys = await redis.keys('rl:otp:ip:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(() => app.close());

describe('POST /auth/otp/request', () => {
  it('sends a code through the provider', async () => {
    const to = await uniquePhone(app);
    const res = await requestOtp({ phone: to });
    expect(res.status).toBe(HttpStatus.NO_CONTENT);
    expect(send).toHaveBeenCalledWith(to);
  });

  it('rejects a number that is not Cambodian E.164 without sending', async () => {
    for (const bad of ['012345678', '+15551234567', '+855012345678', '+8551234']) {
      expect((await requestOtp({ phone: bad })).status).toBe(HttpStatus.BAD_REQUEST);
    }
    expect((await requestOtp({})).status).toBe(HttpStatus.BAD_REQUEST);
    expect(send).not.toHaveBeenCalled();
  });

  it('makes the same number wait before a resend', async () => {
    const to = await uniquePhone(app);
    expect((await requestOtp({ phone: to })).status).toBe(HttpStatus.NO_CONTENT);
    const res = await requestOtp({ phone: to });
    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((res.body as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps requests per IP across different numbers', async () => {
    for (let i = 0; i < 100; i++) expect((await requestOtp({ phone: await uniquePhone(app) })).status).toBe(HttpStatus.NO_CONTENT);
    expect((await requestOtp({ phone: await uniquePhone(app) })).status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });
});

describe('OtpService.verify', () => {
  it('accepts the right code and rejects a wrong one', async () => {
    const otp = app.get(OtpService);
    const to = await uniquePhone(app);
    expect(await otp.verify(to, '123456')).toBe(false);
    expect(await otp.verify(to, '000000')).toBe(true);
  });

  it('locks a number after 5 attempts, even against parallel guesses with the right code among them', async () => {
    const otp = app.get(OtpService);
    const to = await uniquePhone(app);
    const guesses = Array.from({ length: 20 }, (_, i) => otp.verify(to, String(i + 100000)));
    const results = await Promise.allSettled([...guesses, otp.verify(to, '000000')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    await expect(otp.verify(to, '000000')).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });
});
