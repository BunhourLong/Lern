import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type OutboxEvent = { id: string; topic: string; recipients: string[]; payload: unknown };

@Injectable()
export class OutboxRepository {
  constructor(private readonly db: DataSource) {}

  // Deletes up to `limit` rows and hands them to `send` inside the same transaction: if send throws or the
  // process dies before commit, the rows stay for the next drain (at-least-once). SKIP LOCKED lets every
  // instance drain side by side without sending a row twice.
  // A send that throws rolls back its whole batch. That only happens when Redis can't take the push jobs (retrying is
  // right); nothing here calls FCM, which runs later in the push worker.
  claim(limit: number, send: (events: OutboxEvent[]) => void | Promise<void>): Promise<number> {
    return this.db.transaction(async (m) => {
      const [events] = await m.query<[OutboxEvent[], number]>(
        `DELETE FROM outbox_events
         WHERE id IN (SELECT id FROM outbox_events ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING id, topic, recipients, payload`,
        [limit],
      );
      await send(events);
      return events.length;
    });
  }
}
