import type { MigrationInterface, QueryRunner } from 'typeorm';

// Road ETA (s) from the driver to the pickup when the offer was made (PLAN.md §2.4); null on offers made before
export class RideOffersEta1793433600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE ride_offers ADD COLUMN eta_s integer CHECK (eta_s >= 0)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE ride_offers DROP COLUMN eta_s');
  }
}
