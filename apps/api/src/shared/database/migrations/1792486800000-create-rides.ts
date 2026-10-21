import type { MigrationInterface, QueryRunner } from 'typeorm';

// Prices are copied from the quote at booking, never recomputed. Per-state timestamps, cancel fields
// and the driver's one-active-ride index arrive with the transitions.
export class CreateRides1792486800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE rides (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id uuid NOT NULL REFERENCES users (id),
        driver_id uuid REFERENCES drivers (user_id),
        quote_id uuid NOT NULL REFERENCES quotes (id),
        status text NOT NULL DEFAULT 'searching' CHECK (status IN
          ('searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed', 'no_driver_found', 'cancelled')),
        version integer NOT NULL DEFAULT 1,
        vehicle_type text NOT NULL CHECK (vehicle_type IN ('moto', 'remork', 'bajaj')),
        pickup geography(Point, 4326) NOT NULL,
        dropoff geography(Point, 4326) NOT NULL,
        fare_minor bigint NOT NULL CHECK (fare_minor >= 0),
        currency text NOT NULL CHECK (currency IN ('USD', 'KHR')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT rides_quote_id_key UNIQUE (quote_id)
      )`);
    await q.query(`
      CREATE UNIQUE INDEX rides_one_active_per_rider ON rides (rider_id)
      WHERE status IN ('searching', 'driver_assigned', 'driver_arrived', 'in_progress')`);
    await q.query('CREATE INDEX rides_driver_id_idx ON rides (driver_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE rides');
  }
}
