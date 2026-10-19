import type { MigrationInterface, QueryRunner } from 'typeorm';

// availability + version arrive with the driver state machine (M3/M4)
export class CreateDrivers1792392447000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE drivers (
        user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        vehicle_type text NOT NULL CHECK (vehicle_type IN ('moto', 'remork', 'bajaj')),
        plate text NOT NULL,
        verification text NOT NULL DEFAULT 'pending'
          CHECK (verification IN ('pending', 'verified', 'suspended', 'banned')),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE drivers');
  }
}
