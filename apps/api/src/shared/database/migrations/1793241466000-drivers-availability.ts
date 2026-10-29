import type { MigrationInterface, QueryRunner } from 'typeorm';

// The availability machine (contracts driver.transitions.ts): every move is a guarded UPDATE in the tx of
// the offer or ride change behind it. No version column yet: nothing reads one.
export class DriversAvailability1793241466000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE drivers ADD COLUMN availability text NOT NULL DEFAULT 'offline'
        CHECK (availability IN ('offline', 'available', 'reserved', 'on_trip'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE drivers DROP COLUMN availability');
  }
}
