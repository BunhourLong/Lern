import type { MigrationInterface, QueryRunner } from 'typeorm';

// Audit trail: one row per ride version (seq = rides.version), written in the same statement as the
// change, so per-state timestamps come from here. System actions (search deadline) have no user.
export class CreateRideEvents1792576800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE ride_events (
        ride_id uuid NOT NULL REFERENCES rides (id),
        seq integer NOT NULL,
        status text NOT NULL,
        actor text NOT NULL CHECK (actor IN ('rider', 'driver', 'system')),
        actor_id uuid REFERENCES users (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (ride_id, seq),
        CHECK ((actor = 'system') = (actor_id IS NULL))
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ride_events');
  }
}
