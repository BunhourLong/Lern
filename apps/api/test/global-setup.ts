import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { createDataSource } from '../src/shared/database/database';
import { TEMPLATE_DB } from './support/isolated-database';

// Same images as the dev stack: compose.yml is the single source of truth
const compose = readFileSync(join(__dirname, '../../../infra/docker/compose.yml'), 'utf8');
const image = (name: string) => {
  const match = compose.match(new RegExp(`image: (${name}:\\S+)`));
  if (!match) throw new Error(`no ${name} image in infra/docker/compose.yml`);
  return match[1];
};

export default async function globalSetup(): Promise<void> {
  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer(image('postgis/postgis')).withPlatform('linux/amd64').start(),
    new RedisContainer(image('redis')).withCommand(['redis-server', '--maxmemory-policy', 'noeviction']).start(),
  ]);
  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.OTP_PROVIDER = 'dev';
  process.env.PUSH_PROVIDER = 'dev';
  process.env.JWT_SECRET = randomBytes(48).toString('base64');

  const ds = await createDataSource(process.env.DATABASE_URL).initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
  // Admin session on `postgres`: a session on the source DB would block the clone
  const maintenance = new URL(process.env.DATABASE_URL);
  const sharedName = maintenance.pathname.slice(1);
  maintenance.pathname = '/postgres';
  const admin = await createDataSource(maintenance.toString()).initialize();
  try {
    await admin.query(
      `CREATE DATABASE ${TEMPLATE_DB} TEMPLATE ${sharedName} IS_TEMPLATE true ALLOW_CONNECTIONS false`,
    );
  } finally {
    await admin.destroy();
  }
  // globalTeardown runs in this same process
  Object.assign(globalThis, { __containers: [pg, redis] });
}
