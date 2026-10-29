import type { MigrationInterface, QueryRunner } from 'typeorm';

// One driver at a time per ride (PLAN.md §3). The partial uniques back the matcher's locks: one live offer per
// ride and per driver; UNIQUE (ride_id, driver_id) means a driver is never offered the same ride twice.
export class CreateRideOffers1793241933000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE ride_offers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ride_id uuid NOT NULL REFERENCES rides (id),
        driver_id uuid NOT NULL REFERENCES drivers (user_id),
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
        distance_m integer NOT NULL CHECK (distance_m >= 0),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        responded_at timestamptz,
        CHECK ((status = 'pending') = (responded_at IS NULL)),
        CONSTRAINT ride_offers_ride_driver_key UNIQUE (ride_id, driver_id)
      )`);
    await q.query("CREATE UNIQUE INDEX ride_offers_one_pending_per_ride ON ride_offers (ride_id) WHERE status = 'pending'");
    await q.query(
      "CREATE UNIQUE INDEX ride_offers_one_pending_per_driver ON ride_offers (driver_id) WHERE status = 'pending'",
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ride_offers');
  }
}
