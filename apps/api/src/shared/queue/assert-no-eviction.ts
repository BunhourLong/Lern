import type { Redis } from 'ioredis';

// An evicted BullMQ key is a timer that never fires (invariant 9), so refuse to boot on any other policy
export async function assertNoEviction(redis: Redis): Promise<void> {
  const [, policy] = await redis.config('GET', 'maxmemory-policy');
  if (policy !== 'noeviction') throw new Error(`Redis maxmemory-policy must be noeviction for BullMQ, got ${policy}`);
}
