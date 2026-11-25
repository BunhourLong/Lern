import type { MigrationInterface, QueryRunner } from 'typeorm';

// Ride history (M6.11) reads one side's finished rides newest first, keyset by (created_at, id). The partial predicate
// is the query's status list, so the index holds only finished rides and an active ride never costs anything.
export class RidesHistoryIndexes1795593600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX rides_rider_history_idx ON rides (rider_id, created_at DESC, id DESC)
      WHERE status IN ('completed', 'cancelled', 'no_driver_found')`);
    await q.query(`CREATE INDEX rides_driver_history_idx ON rides (driver_id, created_at DESC, id DESC)
      WHERE status IN ('completed', 'cancelled', 'no_driver_found')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX rides_rider_history_idx');
    await q.query('DROP INDEX rides_driver_history_idx');
  }
}
