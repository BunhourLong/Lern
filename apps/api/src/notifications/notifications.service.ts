import type { RegisterDevice } from '@lern/contracts';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type Push, pushFor } from './domain/push-message';
import { NotificationsRepository } from './notifications.repository';
import { PushProvider } from './push.provider';
import { PushQueue } from './push-queue';

// Past this a "driver arrived" or "ride cancelled" is news nobody needs; FCM would otherwise keep it for 4 weeks
const RIDE_PUSH_TTL_MS = 10 * 60 * 1000;
const ENQUEUE_TIMEOUT_MS = 2000;

type OutboxEvent = { id: string; topic: string; recipients: string[]; payload: unknown };

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  constructor(
    private readonly tokens: NotificationsRepository,
    private readonly provider: PushProvider,
    private readonly queue: PushQueue,
  ) {}

  // After bootstrap: handlers need the DB
  onApplicationBootstrap(): void {
    this.queue.process((push) => this.deliver(push));
  }

  register(userId: string, device: RegisterDevice): Promise<void> {
    return this.tokens.register(userId, device);
  }

  // Called inside the outbox claim's transaction (invariant 7): if this fails, the rows stay and are sent again.
  // BullMQ waits for Redis without limit, so a stall has to fail too, or it would hold the transaction open.
  async enqueue(events: OutboxEvent[]): Promise<void> {
    const jobs = events.flatMap((e) => {
      const push = pushFor(e);
      return push ? [{ id: e.id, push }] : [];
    });
    if (jobs.length === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('push enqueue timed out')), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.queue.addBulk(jobs), stalled]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Tokens are read at send time, so a phone that changed user since the event gets nothing meant for the last one
  async deliver({ recipients, message }: Push): Promise<void> {
    const { tokens, nowMs } = await this.tokens.targets(recipients);
    if (tokens.length === 0) return;
    const ttlMs = message.expiresAt ? Date.parse(message.expiresAt) - nowMs : RIDE_PUSH_TTL_MS;
    if (ttlMs <= 0) return;
    const { invalid, retry } = await this.provider.send(tokens, message, { nowMs, ttlMs });
    if (invalid.length > 0) await this.tokens.remove(invalid);
    // A repeat replaces the earlier notification (same tag), so devices that already got it see no second one
    if (retry) throw new Error('FCM asked for a retry');
  }
}
