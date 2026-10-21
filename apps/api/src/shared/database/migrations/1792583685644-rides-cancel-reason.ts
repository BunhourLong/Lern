import type { MigrationInterface, QueryRunner } from 'typeorm';

// A cancelled ride always has a reason and no other ride has one; who cancelled is the ride event's actor
export class RidesCancelReason1792583685644 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE rides
        ADD COLUMN cancel_reason text CHECK (cancel_reason IN
          ('changed_mind', 'waited_too_long', 'driver_not_moving', 'rider_unreachable', 'vehicle_problem', 'other')),
        ADD CONSTRAINT rides_cancel_reason_iff_cancelled CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE rides DROP COLUMN cancel_reason');
  }
}
