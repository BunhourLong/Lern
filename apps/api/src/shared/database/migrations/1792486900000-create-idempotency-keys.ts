import type { MigrationInterface, QueryRunner } from 'typeorm';

// scope = caller's user id, or 'public' for unauthenticated routes (refresh). response is encrypted
// (see idempotency.interceptor.ts) and NULL while the first request is still running.
// shortcut: rows are never purged, and a crash mid-request leaves its key "in progress" for good;
// add a cleanup job (e.g. 24 h) before real traffic
export class CreateIdempotencyKeys1792486900000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE idempotency_keys (
        scope text NOT NULL,
        key uuid NOT NULL,
        request_hash bytea NOT NULL,
        response bytea,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, key)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE idempotency_keys');
  }
}
