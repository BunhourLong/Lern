import type { MigrationInterface, QueryRunner } from 'typeorm';

// Where a user's pushes go (PLAN.md M5 FCM). The token is the key: it identifies a phone, and a phone has one current user.
export class CreateDeviceTokens1793692800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE device_tokens (
        token text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        platform text NOT NULL CHECK (platform IN ('android', 'ios')),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX device_tokens_user ON device_tokens (user_id, updated_at DESC)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE device_tokens');
  }
}
