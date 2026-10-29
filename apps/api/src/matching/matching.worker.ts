import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { MatchingQueue } from '../shared/queue/matching-queue';
import { MATCHING_CONFIG, type MatchingConfig } from './matching.config';
import { MatchingService } from './matching.service';

// Runs matching's jobs on this instance unless MATCHING_WORKER is off. After bootstrap: handlers need the DB.
@Injectable()
export class MatchingWorker implements OnApplicationBootstrap {
  constructor(
    @Inject(MATCHING_CONFIG) private readonly config: MatchingConfig,
    private readonly matching: MatchingService,
    private readonly queue: MatchingQueue,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.MATCHING_WORKER) return;
    this.queue.process({
      sync: ({ rideId }) => this.matching.sync(rideId),
      'offer-timeout': ({ offerId }) => this.matching.expire(offerId),
      sweep: () => this.matching.sweep(),
      reconcile: async () => void (await this.matching.reconcile()),
    });
    // Not awaited: BullMQ waits for Redis without limit, and Redis down at boot must not block startup (/health
    // reports it). A scheduler that failed to register comes back with the next instance's boot.
    this.schedule().catch((err: Error) => new Logger(MatchingWorker.name).warn(`schedulers not registered: ${err.message}`));
  }

  private async schedule(): Promise<void> {
    if (this.config.SWEEP_INTERVAL_MS > 0) await this.queue.every('sweep', this.config.SWEEP_INTERVAL_MS);
    if (this.config.RECONCILE_INTERVAL_MS > 0) await this.queue.every('reconcile', this.config.RECONCILE_INTERVAL_MS);
  }
}
