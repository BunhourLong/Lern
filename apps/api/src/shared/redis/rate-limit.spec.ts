import type { Redis } from 'ioredis';
import { consume } from './rate-limit';

// The MULTI result rows for INCR, EXPIRE and TTL
const redisAnswering = (count: number, ttl: number) => {
  const chain = { incr: () => chain, expire: () => chain, ttl: () => chain, exec: () => Promise.resolve([[null, count], [null, 0], [null, ttl]]) };
  return { multi: () => chain } as unknown as Redis;
};

it('allows a hit within the limit (0) and gives the window’s remaining seconds past it', async () => {
  expect(await consume(redisAnswering(3, 900), 'k', 3, 900)).toBe(0);
  expect(await consume(redisAnswering(4, 42), 'k', 3, 900)).toBe(42);
});

// TTL rounds under 1 s down to 0 (and is -1 without an expiry): 0 means "allowed" to every caller
it('never answers 0 for a hit past the limit', async () => {
  expect(await consume(redisAnswering(4, 0), 'k', 3, 900)).toBe(1);
  expect(await consume(redisAnswering(4, -1), 'k', 3, 900)).toBe(1);
});
