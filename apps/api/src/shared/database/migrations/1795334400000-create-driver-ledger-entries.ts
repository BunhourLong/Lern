import type { MigrationInterface, QueryRunner } from 'typeorm';

// M6.8: on a cash ride the driver keeps the fare and owes the commission. Amounts are from the driver's side
// (balance = SUM, negative = owed). Completion appends the entry in its own statement (RidesRepository.transition).
export class CreateDriverLedgerEntries1795334400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE driver_ledger_entries (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        driver_id uuid NOT NULL REFERENCES drivers (user_id),
        ride_id uuid NOT NULL REFERENCES rides (id),
        kind text NOT NULL CHECK (kind IN ('commission')),
        amount_minor bigint NOT NULL,
        currency text NOT NULL CHECK (currency IN ('USD', 'KHR')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT driver_ledger_entries_commission_debit CHECK (kind <> 'commission' OR amount_minor <= 0),
        UNIQUE (ride_id, kind)
      )`);
    // Rides completed before the ledger, dated at their completed event (the ride's booking time if it has none)
    await q.query(`
      INSERT INTO driver_ledger_entries (driver_id, ride_id, kind, amount_minor, currency, created_at)
      SELECT r.driver_id, r.id, 'commission', -r.commission_minor, r.currency,
             coalesce((SELECT e.created_at FROM ride_events e WHERE e.ride_id = r.id AND e.status = 'completed'), r.created_at)
      FROM rides r WHERE r.status = 'completed'`);
    // Not TRUNCATE: tests empty rides with TRUNCATE … CASCADE
    await q.query(`
      CREATE FUNCTION driver_ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'driver_ledger_entries is append-only: correct an entry with a new one';
      END $$`);
    await q.query(`
      CREATE TRIGGER driver_ledger_entries_append_only BEFORE UPDATE OR DELETE ON driver_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION driver_ledger_entries_append_only()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE driver_ledger_entries');
    await q.query('DROP FUNCTION driver_ledger_entries_append_only()');
  }
}
