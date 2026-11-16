import type { MigrationInterface, QueryRunner } from 'typeorm';

// The language this phone's pushes come in. Every row that existed before this migration is English.
export class DeviceTokensLocale1794816000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE device_tokens ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'km'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE device_tokens DROP COLUMN locale');
  }
}
