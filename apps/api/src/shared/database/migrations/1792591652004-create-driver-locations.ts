import type { MigrationInterface, QueryRunner } from 'typeorm';

// One latest row per driver, upserted by the location module.
// shortcut: no heading/speed/accuracy columns until something reads them, add them with that reader.
export class CreateDriverLocations1792591652004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE driver_locations (
        driver_id uuid PRIMARY KEY REFERENCES drivers (user_id) ON DELETE CASCADE,
        position geography(Point, 4326) NOT NULL,
        recorded_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX driver_locations_position_idx ON driver_locations USING gist (position)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE driver_locations');
  }
}
