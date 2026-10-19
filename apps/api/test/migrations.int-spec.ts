import { Client } from 'pg';
import { createDataSource } from '../src/shared/database/database';
import { requireEnv } from './env';

// A fresh database built from template1, which (unlike the image's default db) has no PostGIS,
// so this proves the migrations themselves create everything and can undo it.
const DB = 'migrations_roundtrip';

async function admin<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client({ connectionString: requireEnv('DATABASE_URL') });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

it('runs every migration up, down and up again', async () => {
  await admin((pg) => pg.query(`DROP DATABASE IF EXISTS ${DB}`).then(() => pg.query(`CREATE DATABASE ${DB}`)));
  const url = new URL(requireEnv('DATABASE_URL'));
  url.pathname = `/${DB}`;
  const ds = await createDataSource(url.toString()).initialize();
  const hasPostgis = async () =>
    (await ds.query<unknown[]>(`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`)).length === 1;

  try {
    expect(ds.migrations.length).toBeGreaterThan(0);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);

    for (let i = 0; i < ds.migrations.length; i++) await ds.undoLastMigration();
    expect(await hasPostgis()).toBe(false);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);
    expect(await ds.showMigrations()).toBe(false); // nothing pending
  } finally {
    await ds.destroy();
  }
});
