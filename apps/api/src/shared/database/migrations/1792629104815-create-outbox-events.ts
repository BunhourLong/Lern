import type { MigrationInterface, QueryRunner } from 'typeorm';

// Invariant 7: written by the same statement as the change it announces. The dispatcher deletes the rows it
// sent (ride_events is the audit trail), so whatever is here is still owed to its recipients.
export class CreateOutboxEvents1792629104815 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE outbox_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        topic text NOT NULL,
        -- an emit to no rooms is a broadcast to every socket
        recipients uuid[] NOT NULL CHECK (cardinality(recipients) > 0),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE outbox_events');
  }
}
