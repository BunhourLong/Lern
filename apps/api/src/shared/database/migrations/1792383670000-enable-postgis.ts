import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnablePostgis1792383670000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE EXTENSION IF NOT EXISTS postgis');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP EXTENSION IF EXISTS postgis');
  }
}
