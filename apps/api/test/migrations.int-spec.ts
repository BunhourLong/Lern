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

    // A ride booked before commission snapshots gets 15% of trip + surge from its quote's lines, rounded up once,
    // plus the whole fee: (10100 + 5000) × 15% = 2265 → 2300, + 500. Cards read 1500 bp. Undo once: rides_commission
    // (each new migration adds one undo here).
    await ds.undoLastMigration();
    const [{ id: cutRiderId }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000004']);
    const [{ id: cutCardId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from)
       VALUES ('bajaj', 3000, 1300, 0, 0, 500, now()) RETURNING id`,
    );
    const [{ id: cutQuoteId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, surge_bp, breakdown,
                           rate_card_id, expires_at)
       VALUES ($1, 'SRID=4326;POINT(104.9 11.5)', 'SRID=4326;POINT(104.8 11.5)', 'bajaj', 5462, 0, 15600, 'KHR', 15000,
               '{"tripMinor": 10100, "surgeMinor": 5000, "bookingFeeMinor": 500}', $2, now()) RETURNING id`,
      [cutRiderId, cutCardId],
    );
    const [{ id: cutRideId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO rides (rider_id, quote_id, vehicle_type, pickup, dropoff, fare_minor, currency)
       SELECT rider_id, id, vehicle_type, pickup, dropoff, amount_minor, currency FROM quotes WHERE id = $1 RETURNING id`,
      [cutQuoteId],
    );
    await ds.runMigrations();
    expect(await ds.query('SELECT commission_bp, commission_minor FROM rides WHERE id = $1', [cutRideId])).toEqual([
      { commission_bp: 1500, commission_minor: '2800' },
    ]);
    expect(await ds.query('SELECT DISTINCT commission_bp FROM rate_cards')).toEqual([{ commission_bp: 1500 }]);
    // No default: a new card must name its rate. NOT NULL and each CHECK reject a copy of a real row.
    const card = `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from, commission_bp)
                  VALUES ('bajaj', 3000, 1300, 0, 0, 500, now() + interval '1 day', $1)`;
    await expect(ds.query(card, [null])).rejects.toThrow(/null value/);
    await expect(ds.query(card, [-1])).rejects.toThrow(/check constraint/);
    await expect(ds.query(card, [10_001])).rejects.toThrow(/check constraint/);
    await expect(
      ds.query(`INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from)
                VALUES ('bajaj', 3000, 1300, 0, 0, 500, now() + interval '1 day')`),
    ).rejects.toThrow(/null value/);
    // Copies of the ride under a fresh rider and quote (the uniques allow one ride per quote and per active rider)
    const ride = `WITH r AS (INSERT INTO users (phone) VALUES ($1) RETURNING id),
                       q AS (INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency,
                                                 surge_bp, breakdown, rate_card_id, expires_at)
                             SELECT r.id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, surge_bp, breakdown,
                                    rate_card_id, expires_at FROM quotes, r WHERE quotes.id = $2 RETURNING *)
                  INSERT INTO rides (rider_id, quote_id, vehicle_type, pickup, dropoff, fare_minor, currency, commission_bp, commission_minor)
                  SELECT rider_id, id, vehicle_type, pickup, dropoff, amount_minor, currency, $3, $4 FROM q`;
    await expect(ds.query(ride, ['+85510000005', cutQuoteId, 1500, 2800])).resolves.toBeDefined();
    await expect(ds.query(ride, ['+85510000006', cutQuoteId, null, 2800])).rejects.toThrow(/null value/);
    await expect(ds.query(ride, ['+85510000007', cutQuoteId, 1500, null])).rejects.toThrow(/null value/);
    await expect(ds.query(ride, ['+85510000008', cutQuoteId, -1, 2800])).rejects.toThrow(/check constraint/);
    await expect(ds.query(ride, ['+85510000009', cutQuoteId, 10_001, 2800])).rejects.toThrow(/check constraint/);
    await expect(ds.query(ride, ['+85510000010', cutQuoteId, 1500, -100])).rejects.toThrow(/check constraint/);
    await expect(ds.query(ride, ['+85510000011', cutQuoteId, 1500, 15_700])).rejects.toThrow(/check constraint/);

    // A quote priced before surge reads 1.0x and receipt lines from its own card's fee (500 here, so a backfill
    // that ignored the card would show). Undo twice: rides_commission, quotes_surge (each new migration adds one undo here).
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    const [{ id: feeRiderId }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000003']);
    const [{ id: feeCardId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from)
       VALUES ('remork', 4000, 1500, 0, 0, 500, now()) RETURNING id`,
    );
    const [{ id: feeQuoteId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, rate_card_id, expires_at)
       VALUES ($1, 'SRID=4326;POINT(104.9 11.5)', 'SRID=4326;POINT(104.8 11.5)', 'remork', 2000, 400, 7500, 'KHR', $2, now()) RETURNING id`,
      [feeRiderId, feeCardId],
    );
    await ds.runMigrations();
    expect(await ds.query('SELECT surge_bp, breakdown FROM quotes WHERE id = $1', [feeQuoteId])).toEqual([
      { surge_bp: 10_000, breakdown: { tripMinor: 7000, surgeMinor: 0, bookingFeeMinor: 500 } },
    ]);

    // A quote priced before rate cards existed points at the seeded card of its vehicle type afterwards, and
    // reads duration 0, the duration it was priced with. Undo five times: rides_commission, quotes_surge, the created_at
    // index, quotes.duration_s, then rate cards (each new migration adds one undo here).
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    await ds.undoLastMigration();
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
    expect(await ds.query('SELECT rate_card_id, duration_s, surge_bp, breakdown FROM quotes WHERE id = $1', [quoteId])).toEqual([
      { rate_card_id: moto.id, duration_s: 0, surge_bp: 10_000, breakdown: { tripMinor: 11_000, surgeMinor: 0, bookingFeeMinor: 0 } },
    ]);

    // A phone registered before the locale column existed must read English after the migration.
    // Undo six times: rides_commission, quotes_surge, the created_at index, quotes.duration_s, rate cards, then the
    // locale column (each new migration adds one undo here).
    await ds.undoLastMigration();
    await ds.undoLastMigration();
    await ds.undoLastMigration();
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
