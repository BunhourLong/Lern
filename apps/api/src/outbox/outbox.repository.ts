import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type OutboxEvent = { topic: string; recipients: string[]; payload: unknown };

@Injectable()
export class OutboxRepository {
  constructor(private readonly db: DataSource) {}

  // Deletes up to `limit` rows and hands them to `send` inside the same transaction: if send throws or the
  // process dies before commit, the rows stay for the next drain (at-least-once). SKIP LOCKED lets every
  // instance drain side by side without sending a row twice.
  // shortcut: one send that throws rolls back its whole batch and blocks the queue head on every retry; fine for
  // socket emits of DB-built JSON, revisit when FCM's awaited sends arrive (M5)
  claim(limit: number, send: (events: OutboxEvent[]) => void): Promise<number> {
    return this.db.transaction(async (m) => {
      const [events] = await m.query<[OutboxEvent[], number]>(
        `DELETE FROM outbox_events
         WHERE id IN (SELECT id FROM outbox_events ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING topic, recipients, payload`,
        [limit],
      );
      send(events);
      return events.length;
    });
  }
}
