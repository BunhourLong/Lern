import type { MigrationInterface, QueryRunner } from 'typeorm';

// The trip duration a quote was priced with (OSRM road seconds, or the straight-line guess when OSRM failed).
// Existing quotes were priced with duration 0 (M6.2), so 0 is their true value; new rows must say theirs.
export class QuotesDuration1794988800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE quotes ADD COLUMN duration_s integer NOT NULL DEFAULT 0 CHECK (duration_s >= 0)');
    await q.query('ALTER TABLE quotes ALTER COLUMN duration_s DROP DEFAULT');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE quotes DROP COLUMN duration_s');
  }
}
