import type { Redis } from 'ioredis';

// Fixed-window counter, atomic across API instances. Returns 0 when this hit is
// within `limit`, otherwise the seconds until the window resets.
export async function consume(redis: Redis, key: string, limit: number, windowSeconds: number): Promise<number> {
  // EXPIRE NX starts the window on the first hit only, so blocked hits never extend it
  const results = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec();
  if (!results) throw new Error('rate-limit transaction was aborted');
  const [count, , ttl] = results.map(([err, value]) => {
    if (err) throw err;
    return value as number;
  });
  return count <= limit ? 0 : ttl;
}
