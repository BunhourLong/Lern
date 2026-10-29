import { Logger } from '@nestjs/common';
import { DelayedError, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

type Jobs = { sync: { rideId: string }; 'offer-timeout': { offerId: string }; sweep: object; reconcile: object };
// A handler that finds its job early returns how long to wait; the same job then runs again that much later
export type Retry = { retryInMs: number };
export type MatchingHandlers = { [K in keyof Jobs]: (data: Jobs[K]) => Promise<void | Retry> };

const NAME = 'matching';

// Matching's durable jobs (invariant 9): handlers re-check state, so a duplicate or late job is harmless.
// Lives in shared so rides can enqueue without importing matching, which imports rides.
export class MatchingQueue {
  private readonly logger = new Logger(MatchingQueue.name);
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
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      },
    });
    this.queue.on('error', (err: Error) => this.logger.warn(err.message));
  }

  async sync(rideId: string, delayMs = 0): Promise<void> {
    await this.queue.add('sync', { rideId }, { delay: delayMs });
  }

  // One timer per offer: the job id makes a repeated add a no-op
  async offerTimeout(offerId: string, delayMs: number): Promise<void> {
    await this.queue.add('offer-timeout', { offerId }, { jobId: offerId, delay: delayMs });
  }

  // Runs once per interval across all instances
  async every(name: 'sweep' | 'reconcile', ms: number): Promise<void> {
    await this.queue.upsertJobScheduler(name, { every: ms }, { name, data: {} });
  }

  process(handlers: MatchingHandlers): void {
    this.worker = new Worker(
      NAME,
      async (job, token) => {
        const result = await (handlers[job.name as keyof Jobs] as (data: unknown) => Promise<void | Retry>)(job.data);
        if (!result) return;
        // BullMQ's way to re-delay the running job; re-adding it would be a no-op (its id still exists)
        await job.moveToDelayed(Date.now() + result.retryInMs, token);
        throw new DelayedError();
      },
      { connection: this.connection, prefix: this.prefix },
    );
    this.worker.on('error', (err: Error) => this.logger.warn(err.message));
    this.worker.on('failed', (job, err: Error) => this.logger.warn(`${job?.name} ${job?.id} failed: ${err.message}`));
  }

  // The worker first: it waits for running jobs, which still need Redis and the DB. Without Redis nothing can
  // finish and the wait never ends, so force it: a cut-off job stalls and reruns, and handlers re-check state
  async close(): Promise<void> {
    await this.worker?.close(this.connection.status !== 'ready');
    await this.queue.close();
    this.connection.disconnect();
  }
}
