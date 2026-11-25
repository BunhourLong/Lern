import type { MigrationInterface, QueryRunner } from 'typeorm';

// Staff auth (M7.A1a): admin staff become their own identity (email + password + session cookie), so app users
// lose the admin role. The new CHECK fails loudly if any 'admin' row exists, rather than deleting it silently.
export class StaffAuthAndDropAdminRole1795680000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check');
    await q.query(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('rider', 'driver'))`);
    await q.query(`
      CREATE TABLE staff_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) > 0),
        display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        is_super_admin boolean NOT NULL DEFAULT false,
        disabled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((status = 'disabled') = (disabled_at IS NOT NULL))
      )`);
    await q.query('CREATE UNIQUE INDEX staff_users_email_lower_idx ON staff_users (lower(email))');
    // RESTRICT: staff are disabled, never deleted, so their audit trail keeps pointing somewhere
    await q.query(`
      CREATE TABLE staff_credentials (
        staff_user_id uuid PRIMARY KEY REFERENCES staff_users (id) ON DELETE RESTRICT,
        password_hash text NOT NULL,
        failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
        locked_until timestamptz,
        password_updated_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // token_hash is sha256 of the cookie value: a database reader can't replay a session
    await q.query(`
      CREATE TABLE staff_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_user_id uuid NOT NULL REFERENCES staff_users (id) ON DELETE RESTRICT,
        token_hash text NOT NULL UNIQUE,
        csrf_token text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_ip text,
        user_agent text
      )`);
    await q.query('CREATE INDEX staff_sessions_live_user_idx ON staff_sessions (staff_user_id) WHERE revoked_at IS NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE staff_sessions');
    await q.query('DROP TABLE staff_credentials');
    await q.query('DROP TABLE staff_users');
    await q.query('ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check');
    await q.query(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('rider', 'driver', 'admin'))`);
  }
}
