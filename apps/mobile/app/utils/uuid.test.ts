import { idempotencyKeySchema } from '@lern/contracts';
import { uuid, uuidFrom } from './uuid';

it.each([
  ['the platform', uuid],
  ['the Math.random fallback', () => uuidFrom(Math.random)],
])(
  'makes v4 UUIDs the server accepts as an Idempotency-Key, different each time (%s)',
  (_, make) => {
    const keys = Array.from({ length: 200 }, make);
    for (const key of keys)
      expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  },
);

it('sets the version and variant nibbles whatever the random source says', () => {
  expect(uuidFrom(() => 0.99)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(uuidFrom(() => 0)).toBe('00000000-0000-4000-8000-000000000000');
});
