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
  const tables = async () =>
    (await ds.query<{ t: string }[]>(`SELECT to_regclass(t)::text AS t FROM unnest($1::text[]) t`, [['users', 'refresh_tokens', 'user_roles', 'drivers', 'quotes', 'rides', 'idempotency_keys', 'ride_events', 'trip_points', 'outbox_events', 'ride_offers', 'driver_availability_events', 'device_tokens', 'rate_cards']]))
      .map((r) => r.t)
      .filter(Boolean);

  try {
    expect(ds.migrations.length).toBeGreaterThan(0);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);
    expect(await tables()).toEqual(['users', 'refresh_tokens', 'user_roles', 'drivers', 'quotes', 'rides', 'idempotency_keys', 'ride_events', 'trip_points', 'outbox_events', 'ride_offers', 'driver_availability_events', 'device_tokens', 'rate_cards']);

    for (let i = 0; i < ds.migrations.length; i++) await ds.undoLastMigration();
    expect(await hasPostgis()).toBe(false);
    expect(await tables()).toEqual([]);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);
    expect(await ds.showMigrations()).toBe(false); // nothing pending

    // A quote priced before rate cards existed points at the seeded card of its vehicle type afterwards, and
    // reads duration 0, the duration it was priced with. Undo twice: quotes.duration_s, then rate cards.
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    const [{ id: riderId }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000002']);
    const [{ id: quoteId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, amount_minor, currency, expires_at)
       VALUES ($1, 'SRID=4326;POINT(104.9 11.5)', 'SRID=4326;POINT(104.8 11.5)', 'moto', 9000, 11000, 'KHR', now()) RETURNING id`,
      [riderId],
    );
    await ds.runMigrations();
    const [moto] = await ds.query<{ id: string }[]>(`SELECT id FROM rate_cards WHERE vehicle_type = 'moto'`);
    expect(await ds.query('SELECT rate_card_id, duration_s FROM quotes WHERE id = $1', [quoteId])).toEqual([{ rate_card_id: moto.id, duration_s: 0 }]);

    // A phone registered before the locale column existed must read English after the migration.
    // Undo three times: quotes.duration_s, rate cards, then the locale column (each new migration adds one undo here).
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    const [{ id }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000001']);
    await ds.query('INSERT INTO device_tokens (token, user_id, platform) VALUES ($1, $2, $3)', ['pre-locale-token', id, 'android']);
    await ds.runMigrations();
    expect(await ds.query('SELECT locale FROM device_tokens WHERE token = $1', ['pre-locale-token'])).toEqual([{ locale: 'en' }]);
    expect(await ds.showMigrations()).toBe(false); // nothing pending
  } finally {
    await ds.destroy();
  }
});
