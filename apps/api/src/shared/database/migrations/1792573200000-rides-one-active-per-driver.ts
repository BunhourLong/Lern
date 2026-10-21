import type { MigrationInterface, QueryRunner } from 'typeorm';

// Invariant 2 for drivers: a driver holds at most one ride between accept and the end of the trip
export class RidesOneActivePerDriver1792573200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE UNIQUE INDEX rides_one_active_per_driver ON rides (driver_id)
      WHERE status IN ('driver_assigned', 'driver_arrived', 'in_progress')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX rides_one_active_per_driver');
  }
}
