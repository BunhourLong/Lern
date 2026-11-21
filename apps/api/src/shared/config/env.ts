import { appVersionSchema, storeUrlSchema } from '@lern/contracts';
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
  // Surge per H3 cell (PLAN.md M6): how often it is recomputed; 0 = off
  SURGE_INTERVAL_MS: z.coerce.number().int().min(0).default(60000),
  // Basis points added per excess rider over one available driver
  SURGE_SLOPE_BP: z.coerce.number().int().min(0).default(5000),
  // Ceiling for a cell, in basis points (10000 = 1.0x)
  SURGE_CAP_BP: z.coerce.number().int().min(10000).default(20000),
  // The most one run may move a cell, so surge ramps instead of jumping
  SURGE_MAX_STEP_BP: z.coerce.number().int().min(1).default(1000),
  // Commission a driver may owe, in KHR riel, and still go online (PLAN.md M6.9); placeholder ~$10, one value for
  // every vehicle type
  DRIVER_DEBT_LIMIT_MINOR: z.coerce.number().int().min(0).default(40000),
  // App config (GET /app-config): a minimum version is shown to users with its store link, so the pair travels together
  APP_MIN_VERSION_IOS: appVersionSchema.optional(),
  APP_STORE_URL_IOS: storeUrlSchema.optional(),
  APP_MIN_VERSION_ANDROID: appVersionSchema.optional(),
  APP_STORE_URL_ANDROID: storeUrlSchema.optional(),
  MAINTENANCE: z.stringbool().default(false),
  // Riel per US dollar for the app's approximate `≈ $` display only, never in money maths
  KHR_PER_USD: z.coerce.number().int().min(1).default(4000),
  NODE_ENV: z.string().min(1).optional(),
  // Staff web admin (PLAN.md M7): off unless asked, so a deploy never exposes /admin by accident
  ADMIN_ENABLED: z.stringbool().default(false),
  // No default: dev approves every login without a second factor, so each deploy must choose it
  STAFF_MFA_PROVIDER: z.enum(['dev', 'duo']).optional(),
  // Duo Universal Prompt (STAFF_MFA_PROVIDER=duo): the Web SDK application's keys, its bare API hostname, and the
  // admin page Duo sends the browser back to
  DUO_CLIENT_ID: z.string().length(20).optional(),
  DUO_CLIENT_SECRET: z.string().length(40).optional(),
  DUO_API_HOST: z
    .string()
    .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i)
    .optional(),
  DUO_REDIRECT_URL: z.url({ protocol: /^https?$/ }).optional(),
  // false only for local http; browsers drop Secure cookies there
  ADMIN_COOKIE_SECURE: z.stringbool().default(true),
}).refine((env) => env.OTP_PROVIDER !== 'telegram' || env.TELEGRAM_GATEWAY_TOKEN, {
  message: 'Required when OTP_PROVIDER is telegram',
  path: ['TELEGRAM_GATEWAY_TOKEN'],
}).refine((env) => env.PUSH_PROVIDER !== 'fcm' || env.FIREBASE_SERVICE_ACCOUNT_PATH, {
  message: 'Required when PUSH_PROVIDER is fcm',
  path: ['FIREBASE_SERVICE_ACCOUNT_PATH'],
}).refine((env) => env.APP_MIN_VERSION_IOS === undefined || env.APP_STORE_URL_IOS !== undefined, {
  message: 'Required with its minimum version',
  path: ['APP_STORE_URL_IOS'],
}).refine((env) => env.APP_STORE_URL_IOS === undefined || env.APP_MIN_VERSION_IOS !== undefined, {
  message: 'Required with its store URL',
  path: ['APP_MIN_VERSION_IOS'],
}).refine((env) => env.APP_MIN_VERSION_ANDROID === undefined || env.APP_STORE_URL_ANDROID !== undefined, {
  message: 'Required with its minimum version',
  path: ['APP_STORE_URL_ANDROID'],
}).refine((env) => env.APP_STORE_URL_ANDROID === undefined || env.APP_MIN_VERSION_ANDROID !== undefined, {
  message: 'Required with its store URL',
  path: ['APP_MIN_VERSION_ANDROID'],
}).refine((env) => !env.ADMIN_ENABLED || env.STAFF_MFA_PROVIDER !== undefined, {
  message: 'Required when ADMIN_ENABLED is true',
  path: ['STAFF_MFA_PROVIDER'],
}).refine((env) => !env.ADMIN_ENABLED || env.NODE_ENV !== 'production' || env.STAFF_MFA_PROVIDER !== 'dev', {
  message: 'dev skips the second factor: not allowed in production',
  path: ['STAFF_MFA_PROVIDER'],
}).refine((env) => !env.ADMIN_ENABLED || env.NODE_ENV !== 'production' || env.ADMIN_COOKIE_SECURE, {
  message: 'Must be true in production',
  path: ['ADMIN_COOKIE_SECURE'],
}).refine((env) => !(env.ADMIN_ENABLED && env.STAFF_MFA_PROVIDER === 'duo') || env.DUO_CLIENT_ID, {
  message: 'Required when STAFF_MFA_PROVIDER is duo',
  path: ['DUO_CLIENT_ID'],
}).refine((env) => !(env.ADMIN_ENABLED && env.STAFF_MFA_PROVIDER === 'duo') || env.DUO_CLIENT_SECRET, {
  message: 'Required when STAFF_MFA_PROVIDER is duo',
  path: ['DUO_CLIENT_SECRET'],
}).refine((env) => !(env.ADMIN_ENABLED && env.STAFF_MFA_PROVIDER === 'duo') || env.DUO_API_HOST, {
  message: 'Required when STAFF_MFA_PROVIDER is duo',
  path: ['DUO_API_HOST'],
}).refine((env) => !(env.ADMIN_ENABLED && env.STAFF_MFA_PROVIDER === 'duo') || env.DUO_REDIRECT_URL, {
  message: 'Required when STAFF_MFA_PROVIDER is duo',
  path: ['DUO_REDIRECT_URL'],
}).refine(
  (env) =>
    !(env.ADMIN_ENABLED && env.STAFF_MFA_PROVIDER === 'duo' && env.NODE_ENV === 'production') ||
    env.DUO_REDIRECT_URL?.startsWith('https://'),
  { message: 'Must be https in production', path: ['DUO_REDIRECT_URL'] },
);

export type Config = z.infer<typeof Env>;

// Throws at boot so a bad env fails fast. Messages name the key, never the value.
export function parseEnv(env: NodeJS.ProcessEnv): Config {
  const result = Env.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
