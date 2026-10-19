import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserRoles1792391999000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('rider', 'driver', 'admin')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE user_roles');
  }
}
