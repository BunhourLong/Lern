import type { Options } from 'pino-http';
import type { Config } from '../config/env';
import { requestId } from './request-id';

// Credentials never reach the logs; bodies (refresh tokens, OTP codes) aren't logged at all
const REDACT = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

export function httpLoggerOptions(level: Config['LOG_LEVEL']): Options {
  return { level, genReqId: requestId, redact: REDACT };
}
