import { healthSchema } from '@lern/contracts';

// Proves Jest (and so Metro's resolver conditions) reach the shared workspace package
test('parses a body with the shared contracts schema', () => {
  expect(healthSchema.safeParse({ status: 'ok', db: 'up', redis: 'up' }).success).toBe(true);
  expect(healthSchema.safeParse({ status: 'ok', db: 'maybe', redis: 'up' }).success).toBe(false);
});
