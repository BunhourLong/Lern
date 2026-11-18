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
    (await ds.query<{ t: string }[]>(`SELECT to_regclass(t)::text AS t FROM unnest($1::text[]) t`, [['users', 'refresh_tokens', 'user_roles', 'drivers', 'quotes', 'rides', 'idempotency_keys', 'ride_events', 'trip_points', 'outbox_events', 'ride_offers', 'driver_availability_events', 'device_tokens', 'rate_cards', 'driver_ledger_entries']]))
      .map((r) => r.t)
      .filter(Boolean);

  try {
    expect(ds.migrations.length).toBeGreaterThan(0);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);
    expect(await tables()).toEqual(['users', 'refresh_tokens', 'user_roles', 'drivers', 'quotes', 'rides', 'idempotency_keys', 'ride_events', 'trip_points', 'outbox_events', 'ride_offers', 'driver_availability_events', 'device_tokens', 'rate_cards', 'driver_ledger_entries']);

    for (let i = 0; i < ds.migrations.length; i++) await ds.undoLastMigration();
    expect(await hasPostgis()).toBe(false);
    expect(await tables()).toEqual([]);

    await ds.runMigrations();
    expect(await hasPostgis()).toBe(true);
    expect(await ds.showMigrations()).toBe(false); // nothing pending

    // A ride completed before the ledger owes its commission, dated at its completed event; a cancelled one owes
    // nothing. Undo once: driver_ledger_entries (each new migration adds one undo here).
    await ds.undoLastMigration();
    const [{ id: ledgerRiderId }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000012']);
    const [{ id: ledgerDriverId }] = await ds.query<{ id: string }[]>('INSERT INTO users (phone) VALUES ($1) RETURNING id', ['+85510000013']);
    await ds.query(`INSERT INTO drivers (user_id, vehicle_type, plate) VALUES ($1, 'moto', '1A-0001')`, [ledgerDriverId]);
    const endedRide = `WITH q AS (INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency,
                                                      surge_bp, breakdown, rate_card_id, expires_at)
                                  SELECT $1, 'SRID=4326;POINT(104.9 11.5)', 'SRID=4326;POINT(104.8 11.5)', 'moto', 2000, 400, 13000, 'KHR', 10000,
                                         '{"tripMinor": 13000, "surgeMinor": 0, "bookingFeeMinor": 0}', id, now()
                                  FROM rate_cards WHERE vehicle_type = 'moto' LIMIT 1 RETURNING *)
                       INSERT INTO rides (rider_id, driver_id, quote_id, status, version, vehicle_type, pickup, dropoff, fare_minor, currency,
                                          commission_bp, commission_minor, cancel_reason)
                       SELECT rider_id, $2, id, $3, 5, vehicle_type, pickup, dropoff, amount_minor, currency, 1500, 2000, $4 FROM q RETURNING id`;
    const [{ id: completedId }] = await ds.query<{ id: string }[]>(endedRide, [ledgerRiderId, ledgerDriverId, 'completed', null]);
    const [{ id: cancelledId }] = await ds.query<{ id: string }[]>(endedRide, [ledgerRiderId, ledgerDriverId, 'cancelled', 'changed_mind']);
    const event = `INSERT INTO ride_events (ride_id, seq, status, actor, actor_id, created_at) VALUES ($1, 5, $2, $3, $4, $5)`;
    await ds.query(event, [completedId, 'completed', 'driver', ledgerDriverId, '2026-11-01T10:00:00Z']);
    await ds.query(event, [cancelledId, 'cancelled', 'rider', ledgerRiderId, '2026-11-01T11:00:00Z']);
    // A completed ride without its event (none exist; the fallback keeps the backfill from failing on one) is dated at booking
    const [{ id: eventlessId }] = await ds.query<{ id: string }[]>(endedRide, [ledgerRiderId, ledgerDriverId, 'completed', null]);
    await ds.query(`UPDATE rides SET created_at = '2026-11-02T09:00:00Z' WHERE id = $1`, [eventlessId]);
    await ds.runMigrations();
    expect(
      await ds.query('SELECT driver_id, ride_id, kind, amount_minor, currency, created_at FROM driver_ledger_entries ORDER BY created_at'),
    ).toEqual([
      { driver_id: ledgerDriverId, ride_id: completedId, kind: 'commission', amount_minor: '-2000', currency: 'KHR', created_at: new Date('2026-11-01T10:00:00Z') },
      { driver_id: ledgerDriverId, ride_id: eventlessId, kind: 'commission', amount_minor: '-2000', currency: 'KHR', created_at: new Date('2026-11-02T09:00:00Z') },
    ]);
    // Append-only; one entry per ride and kind; a commission never credits the driver; only known kinds
    await expect(ds.query('UPDATE driver_ledger_entries SET amount_minor = 0')).rejects.toThrow(/append-only/);
    await expect(ds.query('DELETE FROM driver_ledger_entries')).rejects.toThrow(/append-only/);
    const entry = `INSERT INTO driver_ledger_entries (driver_id, ride_id, kind, amount_minor, currency) VALUES ($1, $2, $3, $4, 'KHR')`;
    await expect(ds.query(entry, [ledgerDriverId, completedId, 'commission', -2000])).rejects.toThrow(/driver_ledger_entries_ride_id_kind_key/);
    await expect(ds.query(entry, [ledgerDriverId, cancelledId, 'commission', 1])).rejects.toThrow(/driver_ledger_entries_commission_debit/);
    await expect(ds.query(entry, [ledgerDriverId, cancelledId, 'payout', 100])).rejects.toThrow(/driver_ledger_entries_kind_check/);

    // A ride booked before commission snapshots gets 15% of trip + surge from its quote's lines, rounded up once,
    // plus the whole fee: (10100 + 5000) × 15% = 2265 → 2300, + 500. Cards read 1500 bp. Undo twice: driver_ledger_entries,
    // rides_commission (each new migration adds one undo here).
    await ds.undoLastMigration();
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
    // that ignored the card would show). Undo three times: driver_ledger_entries, rides_commission, quotes_surge (each new
    // migration adds one undo here).
    await ds.undoLastMigration();
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
    // reads duration 0, the duration it was priced with. Undo six times: driver_ledger_entries, rides_commission, quotes_surge, the created_at
    // index, quotes.duration_s, then rate cards (each new migration adds one undo here).
    await ds.undoLastMigration();
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
    // Undo seven times: driver_ledger_entries, rides_commission, quotes_surge, the created_at index, quotes.duration_s,
    // rate cards, then the locale column (each new migration adds one undo here).
    await ds.undoLastMigration();
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
  // Builds and drops the whole schema (PostGIS included) several times, and every migration adds work: 2–5 s under
  // full-suite load had reached Jest's 5 s default (user's call, 2026-11-18)
}, 30_000);
