import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // No default: the dev provider accepts a fixed code for every phone, so each deploy must choose it
  OTP_PROVIDER: z.enum(['dev', 'telegram']),
  TELEGRAM_GATEWAY_TOKEN: z.string().min(1).optional(),
  // Overridable so tests can point at a local fake of the API
  TELEGRAM_GATEWAY_URL: z.url({ protocol: /^https?$/ }).default('https://gatewayapi.telegram.org'),
  // No default: a deploy that forgets it would silently send no pushes
  PUSH_PROVIDER: z.enum(['dev', 'fcm']),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
  // HS256 key: at least 256 bits; generate with `openssl rand -base64 48`
  JWT_SECRET: z.string().min(32),
  // Matching (PLAN.md §2.4)
  OFFER_TTL_SECONDS: z.coerce.number().int().min(1).default(15),
  SEARCH_DEADLINE_SECONDS: z.coerce.number().int().min(1).default(90),
  // Rides searching without an offer are synced this often (retry + bookings whose enqueue was lost); 0 = off
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
  // Repairs what lost jobs left behind (expired offers still pending, drivers stuck reserved/on_trip); 0 = off
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
  // false = this instance only enqueues jobs, another one runs them
  MATCHING_WORKER: z.stringbool().default(true),
  QUEUE_PREFIX: z.string().min(1).default('lern'),
  // Presence (PLAN.md M5): how often the sweep runs (0 = off), when a driver on a ride counts as silent, and when
  // a silent available driver is taken offline
  PRESENCE_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
  DRIVER_STALE_SECONDS: z.coerce.number().int().min(1).default(30),
  DRIVER_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(300),
  // Stuck trips (PLAN.md M5): an in_progress ride is flagged for admin after this long without a driver point, or
  // after this long in progress at all
  STUCK_GAP_SECONDS: z.coerce.number().int().min(1).default(600),
  STUCK_CAP_SECONDS: z.coerce.number().int().min(1).default(7200),
  // Road ETAs for matching; when it can't answer, candidates keep straight-line order
  OSRM_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:5050'),
}).refine((env) => env.OTP_PROVIDER !== 'telegram' || env.TELEGRAM_GATEWAY_TOKEN, {
  message: 'Required when OTP_PROVIDER is telegram',
  path: ['TELEGRAM_GATEWAY_TOKEN'],
}).refine((env) => env.PUSH_PROVIDER !== 'fcm' || env.FIREBASE_SERVICE_ACCOUNT_PATH, {
  message: 'Required when PUSH_PROVIDER is fcm',
  path: ['FIREBASE_SERVICE_ACCOUNT_PATH'],
});

export type Config = z.infer<typeof Env>;

// Throws at boot so a bad env fails fast. Messages name the key, never the value.
export function parseEnv(env: NodeJS.ProcessEnv): Config {
  const result = Env.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
