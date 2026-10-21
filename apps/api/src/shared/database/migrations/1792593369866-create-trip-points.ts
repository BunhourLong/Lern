import type { MigrationInterface, QueryRunner } from 'typeorm';

// Breadcrumbs of in_progress rides, written by the location module. The unique index is the sampler:
// one point per ride per 10 s bucket, so concurrent or replayed batches can't add more.
export class CreateTripPoints1792593369866 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE trip_points (
        ride_id uuid NOT NULL REFERENCES rides (id),
        position geography(Point, 4326) NOT NULL,
        recorded_at timestamptz NOT NULL
      )`);
    await q.query(`
      CREATE UNIQUE INDEX trip_points_one_per_bucket
      ON trip_points (ride_id, date_bin('10 seconds', recorded_at, timestamptz '2000-01-01Z'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE trip_points');
  }
}
