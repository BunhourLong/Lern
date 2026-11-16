import type { MigrationInterface, QueryRunner } from 'typeorm';

// History of the availability machine: one row per move, written in the same statement as the move, so
// what a driver did and when (e.g. dropping offline between offers) can be audited. Refused moves aren't logged.
// shortcut: append-only and never pruned; add retention (or partition by month) when it gets large.
export class CreateDriverAvailabilityEvents1793255695994 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE driver_availability_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        driver_id uuid NOT NULL REFERENCES drivers (user_id),
        action text NOT NULL,
        from_state text NOT NULL,
        to_state text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX driver_availability_events_driver ON driver_availability_events (driver_id, id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE driver_availability_events');
  }
}
