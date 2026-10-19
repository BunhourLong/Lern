import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndRefreshTokens1792391315000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // One row per issued refresh token; family_id groups one login's rotations (one device session)
    await q.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX refresh_tokens_live_family_idx ON refresh_tokens (family_id) WHERE revoked_at IS NULL');
    await q.query('CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE refresh_tokens');
    await q.query('DROP TABLE users');
  }
}
