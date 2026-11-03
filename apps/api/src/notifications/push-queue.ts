import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Push } from './domain/push-message';

const NAME = 'push';
// A slow FCM call must not make the next driver's 15 s offer wait behind it
const CONCURRENCY = 10;

// Durable sends, on their own queue so FCM's latency never delays matching's jobs. Retries are quick: an offer
// lives 15 s, and a client that missed a ride push still reconciles from REST when it next opens.
export class PushQueue implements OnModuleDestroy {
  private readonly logger = new Logger(PushQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    redis: Redis,
    private readonly prefix: string,
  ) {
    // BullMQ requires no per-command retry limit; duplicate() copies options, not the error listener
    this.connection = redis.duplicate({ maxRetriesPerRequest: null });
    this.connection.on('error', (err: Error) => this.logger.warn(err.message));
    this.queue = new Queue(NAME, {
      connection: this.connection,
      prefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
        // Kept for a while: BullMQ only refuses a duplicate id while the job exists, and a rolled-back claim re-adds
        removeOnComplete: { age: 3600 },
        removeOnFail: { count: 1000 },
      },
    });
    this.queue.on('error', (err: Error) => this.logger.warn(err.message));
  }

  // The outbox row's id makes a re-add after a rolled-back claim a no-op
  async addBulk(jobs: { id: string; push: Push }[]): Promise<void> {
    await this.queue.addBulk(jobs.map(({ id, push }) => ({ name: NAME, data: push, opts: { jobId: `push-${id}` } })));
  }

  process(handler: (push: Push) => Promise<void>): void {
    this.worker = new Worker<Push>(NAME, (job) => handler(job.data), {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: CONCURRENCY,
    });
    this.worker.on('error', (err: Error) => this.logger.warn(err.message));
    this.worker.on('failed', (job, err: Error) => this.logger.warn(`push ${job?.id} failed: ${err.message}`));
  }

  // The worker first, forced without Redis: see MatchingQueue.close
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close(this.connection.status !== 'ready');
    await this.queue.close();
    this.connection.disconnect();
  }
}
