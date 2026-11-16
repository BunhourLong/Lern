import type { MigrationInterface, QueryRunner } from 'typeorm';

// Prices per vehicle type, versioned by active_from (the active card is the newest one at DB now()).
// integer, not bigint: node-pg returns bigint as a string and fare() refuses it. Whole riel, KHR only (M6.0).
// Append-only: a price change is a new row, so a quote's rate_card_id always means the price it was given.
export class CreateRateCards1794902400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE rate_cards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_type text NOT NULL CHECK (vehicle_type IN ('moto', 'remork', 'bajaj')),
        base integer NOT NULL CHECK (base >= 0),
        per_km integer NOT NULL CHECK (per_km >= 0),
        per_min integer NOT NULL CHECK (per_min >= 0),
        minimum_fare integer NOT NULL CHECK (minimum_fare >= 0),
        booking_fee integer NOT NULL CHECK (booking_fee >= 0),
        active_from timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (vehicle_type, active_from)
      )`);
    await q.query(`
      CREATE FUNCTION rate_cards_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'rate_cards is append-only: add a card with a later active_from instead';
      END $$`);
    await q.query(`
      CREATE TRIGGER rate_cards_append_only BEFORE UPDATE OR DELETE ON rate_cards
      FOR EACH ROW EXECUTE FUNCTION rate_cards_append_only()`);
    // The pre-M6 placeholder prices, active before any existing quote
    await q.query(`
      INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, active_from) VALUES
        ('moto', 2000, 1000, 0, 0, 0, '2026-01-01T00:00:00+07:00'),
        ('bajaj', 3000, 1300, 0, 0, 0, '2026-01-01T00:00:00+07:00'),
        ('remork', 4000, 1500, 0, 0, 0, '2026-01-01T00:00:00+07:00')`);
    await q.query('ALTER TABLE quotes ADD COLUMN rate_card_id uuid REFERENCES rate_cards (id)');
    await q.query(`UPDATE quotes SET rate_card_id = c.id FROM rate_cards c WHERE c.vehicle_type = quotes.vehicle_type`);
    await q.query('ALTER TABLE quotes ALTER COLUMN rate_card_id SET NOT NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE quotes DROP COLUMN rate_card_id');
    await q.query('DROP TABLE rate_cards');
    await q.query('DROP FUNCTION rate_cards_append_only()');
  }
}
