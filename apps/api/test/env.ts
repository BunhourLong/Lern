// Fail loudly instead of letting pg/ioredis fall back to localhost (the dev stack)
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; integration tests get it from test/global-setup.ts`);
  return value;
}
