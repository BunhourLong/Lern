import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { type OutboxEvent, OutboxRepository } from './outbox.repository';

const BATCH = 100;
const POLL_MS = 1000;

// Sends outbox rows to their recipients' user rooms. The writer kicks it after commit; the poll picks up rows
// whose writer died first (or another instance's). "Sent" = handed to Socket.IO: a client that misses it
// reconciles from the REST snapshot on reconnect (invariant 8).
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private poll?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private again = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Not a business timer: losing it only delays delivery until the next kick or restart
  onModuleInit(): void {
    this.poll = setInterval(() => this.kick(), POLL_MS);
  }

  // Runs before Redis and the DB close, so no drain sends into a closed connection
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.poll);
    this.poll = undefined;
    await this.draining;
  }

  // Kicks during a drain coalesce into one more pass, so a row committed mid-drain isn't left for the poll
  kick(): void {
    if (!this.poll) return; // shutting down
    // Claiming deletes the row: without Redis the event would be lost to every other instance's sockets
    if (!this.realtime.canFanOut()) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drain()
      .catch((err: Error) => this.logger.warn(`outbox drain failed, retrying on the next kick: ${err.message}`))
      .finally(() => (this.draining = undefined));
  }

  private async drain(): Promise<void> {
    do {
      this.again = false;
      while ((await this.outbox.claim(BATCH, (events) => this.send(events))) === BATCH);
    } while (this.again);
  }

  private send(events: OutboxEvent[]): void {
    for (const e of events) this.realtime.server.to(e.recipients.map((id) => `user:${id}`)).emit(e.topic, e.payload);
  }
}
