import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // No default: the dev provider accepts a fixed code for every phone, so each deploy must choose it
  OTP_PROVIDER: z.enum(['dev']),
});

export type Config = z.infer<typeof Env>;

// Throws at boot so a bad env fails fast. Messages name the key, never the value.
export function parseEnv(env: NodeJS.ProcessEnv): Config {
  const result = Env.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
