import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://lern:lern@127.0.0.1:5432/lern',
  REDIS_URL: 'redis://127.0.0.1:6379',
  OTP_PROVIDER: 'dev',
  JWT_SECRET: 'a-test-secret-that-is-32-chars-long',
};

it('rejects an env without DATABASE_URL and REDIS_URL, naming both', () => {
  expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
});

it('returns typed config with defaults for a valid env', () => {
  expect(parseEnv(valid)).toEqual({
    ...valid,
    PORT: 3000,
    LOG_LEVEL: 'info',
    TELEGRAM_GATEWAY_URL: 'https://gatewayapi.telegram.org',
    OFFER_TTL_SECONDS: 15,
    SEARCH_DEADLINE_SECONDS: 90,
    SWEEP_INTERVAL_MS: 5000,
    RECONCILE_INTERVAL_MS: 30000,
    MATCHING_WORKER: true,
    QUEUE_PREFIX: 'lern',
  });
});

it('reads MATCHING_WORKER=false as off, not as a truthy string', () => {
  expect(parseEnv({ ...valid, MATCHING_WORKER: 'false' }).MATCHING_WORKER).toBe(false);
});

it('coerces PORT from the string the environment provides', () => {
  expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
});

it('rejects a URL with the wrong scheme without echoing it (URLs carry passwords)', () => {
  const run = () => parseEnv({ ...valid, DATABASE_URL: 'mysql://lern:s3cret@db/lern' });
  expect(run).toThrow(/DATABASE_URL/);
  expect(run).not.toThrow(/s3cret/);
});

it('has no default OTP provider, so no deploy gets the fixed dev code by accident', () => {
  expect(() => parseEnv({ ...valid, OTP_PROVIDER: undefined })).toThrow(/OTP_PROVIDER/);
  expect(() => parseEnv({ ...valid, OTP_PROVIDER: 'twilio' })).toThrow(/OTP_PROVIDER/);
});

it('requires a JWT secret long enough for HS256, without echoing it', () => {
  expect(() => parseEnv({ ...valid, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
  const run = () => parseEnv({ ...valid, JWT_SECRET: 'short-s3cret' });
  expect(run).toThrow(/JWT_SECRET/);
  expect(run).not.toThrow(/short-s3cret/);
});

it('requires a non-empty Gateway token when OTP_PROVIDER is telegram', () => {
  expect(() => parseEnv({ ...valid, OTP_PROVIDER: 'telegram' })).toThrow(/TELEGRAM_GATEWAY_TOKEN/);
  const config = parseEnv({ ...valid, OTP_PROVIDER: 'telegram', TELEGRAM_GATEWAY_TOKEN: 'tg-s3cret' });
  expect(config.TELEGRAM_GATEWAY_URL).toBe('https://gatewayapi.telegram.org');
  expect(config.TELEGRAM_GATEWAY_TOKEN).toBe('tg-s3cret');
  expect(() => parseEnv({ ...valid, OTP_PROVIDER: 'telegram', TELEGRAM_GATEWAY_TOKEN: '' })).toThrow(
    /TELEGRAM_GATEWAY_TOKEN/,
  );
});
