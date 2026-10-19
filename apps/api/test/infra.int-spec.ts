import { Client } from 'pg';
import { Redis } from 'ioredis';
import { createDataSource } from '../src/database';
import { requireEnv } from './env';

it('provides PostGIS 3.6 and Redis', async () => {
  const pg = new Client({ connectionString: requireEnv('DATABASE_URL') });
  await pg.connect();
  try {
    const { rows } = await pg.query<{ v: string }>('select postgis_lib_version() as v');
    expect(rows[0].v).toMatch(/^3\.6\./);
  } finally {
    await pg.end();
  }

  const redis = new Redis(requireEnv('REDIS_URL'));
  try {
    expect(await redis.ping()).toBe('PONG');
  } finally {
    redis.disconnect();
  }
});

it('applies all migrations in globalSetup', async () => {
  const ds = await createDataSource(requireEnv('DATABASE_URL')).initialize();
  try {
    expect(await ds.showMigrations()).toBe(false);
  } finally {
    await ds.destroy();
  }
});
