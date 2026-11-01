import type { MigrationInterface, QueryRunner } from 'typeorm';

// Trips an admin should look at (PLAN.md M5 stuck trips): the reconciler opens a flag, an admin resolves it (M7).
// One open flag per ride and reason, so the 30 s reconciler never piles them up.
export class CreateRideFlags1793606400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE ride_flags (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ride_id uuid NOT NULL REFERENCES rides (id),
        reason text NOT NULL CHECK (reason IN ('no_heartbeat', 'over_cap')),
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        resolved_by uuid REFERENCES users (id)
      )`);
    await q.query('CREATE UNIQUE INDEX ride_flags_one_open ON ride_flags (ride_id, reason) WHERE resolved_at IS NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ride_flags');
  }
}
