import { parseEnv } from './env';

const valid = { DATABASE_URL: 'postgres://lern:lern@127.0.0.1:5432/lern', REDIS_URL: 'redis://127.0.0.1:6379' };

it('rejects an env without DATABASE_URL and REDIS_URL, naming both', () => {
  expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
});

it('returns typed config with defaults for a valid env', () => {
  expect(parseEnv(valid)).toEqual({ ...valid, PORT: 3000, LOG_LEVEL: 'info' });
});

it('coerces PORT from the string the environment provides', () => {
  expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
});

it('rejects a URL with the wrong scheme without echoing it (URLs carry passwords)', () => {
  const run = () => parseEnv({ ...valid, DATABASE_URL: 'mysql://lern:s3cret@db/lern' });
  expect(run).toThrow(/DATABASE_URL/);
  expect(run).not.toThrow(/s3cret/);
});
