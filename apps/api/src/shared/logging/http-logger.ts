import type { Options, stdSerializers } from 'pino-http';
import type { Config } from '../config/env';
import { requestId } from './request-id';

// Credentials never reach the logs; bodies (refresh tokens, OTP codes) aren't logged at all. Referer and query
// strings can carry Duo's code and state (the admin SPA's MFA return page has them in its URL).
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers.referer',
  'res.headers["set-cookie"]',
];

// pino-http hands this the standard serialized request: keep the path, drop the query
const req = (serialized: ReturnType<typeof stdSerializers.req>) => ({ ...serialized, url: serialized.url.split('?')[0], query: undefined });

export function httpLoggerOptions(level: Config['LOG_LEVEL']): Options {
  return { level, genReqId: requestId, redact: REDACT, serializers: { req } };
}
