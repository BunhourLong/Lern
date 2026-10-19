import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { consume } from '../src/shared/redis/rate-limit';
import { requireEnv } from './env';

const redis = new Redis(requireEnv('REDIS_URL'));
afterAll(() => redis.quit());

it('allows `limit` hits per window, then returns the seconds until it resets', async () => {
  const key = `test:${randomUUID()}`;
  const hits = await Promise.all(Array.from({ length: 5 }, () => consume(redis, key, 3, 60)));
  expect(hits.filter((retryAfter) => retryAfter === 0)).toHaveLength(3);
  for (const retryAfter of hits.filter(Boolean)) expect(retryAfter).toBeGreaterThan(55);
});

it('starts a new window once the old one expires, without extending it on blocked hits', async () => {
  const key = `test:${randomUUID()}`;
  expect(await consume(redis, key, 1, 1)).toBe(0);
  expect(await consume(redis, key, 1, 1)).toBeGreaterThan(0);
  await sleep(1100);
  expect(await consume(redis, key, 1, 1)).toBe(0);
});
