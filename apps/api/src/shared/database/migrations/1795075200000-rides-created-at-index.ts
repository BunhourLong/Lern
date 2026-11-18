import type { MigrationInterface, QueryRunner } from 'typeorm';

// The surge job counts rides created in the last 60 s every minute, so created_at needs an index (M6.5).
export class RidesCreatedAtIndex1795075200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE INDEX rides_created_at_idx ON rides (created_at)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX rides_created_at_idx');
  }
}
