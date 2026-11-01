import type { MigrationInterface, QueryRunner } from 'typeorm';

// The ride whose rider was told the driver went silent (PLAN.md M5 presence); cleared when points resume.
// No FK: rides are never deleted, and one would make TRUNCATE rides … CASCADE (tests) empty driver_locations
export class DriverLocationsStaleRide1793520000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE driver_locations ADD COLUMN stale_ride_id uuid');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE driver_locations DROP COLUMN stale_ride_id');
  }
}
