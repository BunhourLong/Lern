import type { Redis } from 'ioredis';
import { assertNoEviction } from './assert-no-eviction';

const redisWith = (policy: string) => ({ config: () => Promise.resolve(['maxmemory-policy', policy]) }) as unknown as Redis;

it('accepts noeviction', async () => {
  await expect(assertNoEviction(redisWith('noeviction'))).resolves.toBeUndefined();
});

it('refuses a policy that may evict job keys', async () => {
  await expect(assertNoEviction(redisWith('allkeys-lru'))).rejects.toThrow(/noeviction.*allkeys-lru/);
});
