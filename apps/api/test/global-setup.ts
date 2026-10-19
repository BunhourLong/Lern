import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { createDataSource } from '../src/shared/database/database';

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
    new RedisContainer(image('redis')).start(),
  ]);
  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.OTP_PROVIDER = 'dev';

  const ds = await createDataSource(process.env.DATABASE_URL).initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
  // globalTeardown runs in this same process
  Object.assign(globalThis, { __containers: [pg, redis] });
}
