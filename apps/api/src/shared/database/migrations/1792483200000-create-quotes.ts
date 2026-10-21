import type { MigrationInterface, QueryRunner } from 'typeorm';

// shortcut: rate_card_id, duration_s, surge_bp and breakdown arrive with OSRM and rate cards (M6);
// expired rows are never purged yet, add a cleanup job before real traffic
export class CreateQuotes1792483200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        pickup geography(Point, 4326) NOT NULL,
        dropoff geography(Point, 4326) NOT NULL,
        vehicle_type text NOT NULL CHECK (vehicle_type IN ('moto', 'remork', 'bajaj')),
        distance_m integer NOT NULL CHECK (distance_m >= 0),
        amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
        currency text NOT NULL CHECK (currency IN ('USD', 'KHR')),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX quotes_rider_id_idx ON quotes (rider_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE quotes');
  }
}
