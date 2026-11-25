import type { MigrationInterface, QueryRunner } from 'typeorm';

// One rating per side per ride: the primary key is the rule (ratings are final)
export class CreateRatings1795507200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE ratings (
        ride_id uuid NOT NULL REFERENCES rides (id),
        from_user uuid NOT NULL REFERENCES users (id),
        to_user uuid NOT NULL REFERENCES users (id),
        stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment text CHECK (char_length(comment) <= 500),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (ride_id, from_user)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ratings');
  }
}
