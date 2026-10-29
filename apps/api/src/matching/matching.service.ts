import type { Offer, Ride } from '@lern/contracts';
import { ConflictException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriversService } from '../drivers/drivers.service';
import { OutboxService } from '../outbox/outbox.service';
import { RidesService } from '../rides/rides.service';
import { MatchingQueue, type Retry } from '../shared/queue/matching-queue';
import { searchRadiusM } from './domain/search-radius';
import { MATCHING_CONFIG, type MatchingConfig } from './matching.config';
import { MatchingRepository } from './matching.repository';

const SWEEP_BATCH = 100;
const RECONCILE_BATCH = 100;

// Rolls an accept back when the offer or the ride is no longer in a state that allows it
class NotAccepted extends Error {}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @Inject(MATCHING_CONFIG) private readonly config: MatchingConfig,
    private readonly db: DataSource,
    private readonly drivers: DriversService,
    private readonly offers: MatchingRepository,
    private readonly outbox: OutboxService,
    private readonly queue: MatchingQueue,
    private readonly rides: RidesService,
  ) {}

  // Does whatever the ride is due: offer it to the next driver, give up at the deadline, or end the offer of a
  // ride that stopped searching. Idempotent, so duplicate jobs are harmless. One transaction with the ride locked
  // first (lock order ride → driver → offer), so two syncs of one ride never interleave.
  async sync(rideId: string): Promise<void> {
    const offerId = await this.db.transaction(async (m) => {
      const ride = await this.rides.lockForMatching(m, rideId);
      if (!ride) return;
      if (ride.status !== 'searching') {
        const driverId = await this.offers.cancelPending(m, rideId);
        if (driverId) await this.drivers.move(m, driverId, 'release');
        return;
      }
      if (await this.offers.hasPending(m, rideId)) return;
      if (ride.elapsedS >= this.config.SEARCH_DEADLINE_SECONDS) {
        await this.rides.expire(m, rideId);
        return;
      }
      const candidate = await this.offers.candidate(m, { ...ride, rideId, radiusM: searchRadiusM(ride.elapsedS) });
      if (!candidate) return; // the sweep tries again
      // The candidate row is locked and was available, so this can't miss
      if (!(await this.drivers.move(m, candidate.driverId, 'reserve'))) throw new Error('locked candidate not available');
      return this.offers.insert(m, rideId, candidate, this.config.OFFER_TTL_SECONDS);
    });
    this.outbox.kick();
    // Committed either way: a timer that can't be queued is the reconciler's to catch, not this sync's to fail
    if (offerId) {
      await this.queue
        .offerTimeout(offerId, this.config.OFFER_TTL_SECONDS * 1000)
        .catch((err: Error) => this.logger.warn(`timer for offer ${offerId} not queued: ${err.message}`));
    }
  }

  // The offer's timer (invariant 9). Re-checks state: an answered offer is left alone, and one that isn't due by
  // the DB clock yet (the timer's clock ran ahead) asks to run again when it is. An expired offer frees its
  // driver, tells them, and the ride moves on to the next driver.
  async expire(offerId: string): Promise<void | Retry> {
    let retryInMs: number | undefined;
    const expired = await this.db.transaction(async (m) => {
      const offer = await this.offers.expire(m, offerId);
      if (offer) await this.drivers.move(m, offer.driverId, 'release');
      else retryInMs = await this.offers.remainingMs(m, offerId);
      return offer;
    });
    if (!expired) return retryInMs ? { retryInMs } : undefined;
    this.outbox.kick();
    return this.sync(expired.rideId);
  }

  // One transaction, ride first (lock order ride → offer → driver): the guarded ride move, the guarded offer
  // move (invariant 3) and the driver's reserved → on_trip. Any one missing rolls back all three.
  async accept(driverId: string, offerId: string): Promise<Ride> {
    let ride: Ride;
    try {
      ride = await this.db.transaction(async (m) => {
        const offer = await this.offers.findForDriver(m, offerId, driverId);
        if (!offer) throw new NotFoundException('Offer not found');
        const assigned = await this.rides.assign(m, driverId, offer.rideId);
        if (!assigned || !(await this.offers.accept(m, offerId, driverId))) throw new NotAccepted();
        if (!(await this.drivers.move(m, driverId, 'assign'))) throw new NotAccepted();
        return assigned;
      });
    } catch (err) {
      if (err instanceof NotAccepted) throw await this.conflict(driverId, offerId, 'accepted');
      throw err;
    }
    this.outbox.kick();
    return ride;
  }

  async decline(driverId: string, offerId: string): Promise<Offer> {
    const offer = await this.db.transaction(async (m) => {
      const declined = await this.offers.decline(m, offerId, driverId);
      // A driver who isn't reserved has drifted; the reconciler repairs that
      if (declined) await this.drivers.move(m, driverId, 'release');
      return declined;
    });
    if (!offer) throw await this.conflict(driverId, offerId, 'declined');
    this.queue.sync(offer.rideId).catch((err: Error) => this.logger.warn(`sync of ${offer.rideId} not queued: ${err.message}`));
    return offer;
  }

  // 404 unless it's the caller's offer; otherwise 409 with the offer to reconcile with
  private async conflict(driverId: string, offerId: string, verb: string): Promise<Error> {
    const offer = await this.offers.snapshot(offerId, driverId);
    if (!offer) return new NotFoundException('Offer not found');
    return new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      code: 'INVALID_TRANSITION',
      message: `Offer can't be ${verb} any more`,
      offer,
    });
  }

  // Box 7: repairs what a lost job or a bug left behind, through the same guarded moves as the normal path.
  // Each count is rows found and handed to repair; anything above zero is logged (a metric with box 11).
  async reconcile(): Promise<Record<'lostTimers' | 'staleOffers' | 'reservedWithoutOffer' | 'onTripWithoutRide', number>> {
    const counts = { lostTimers: 0, staleOffers: 0, reservedWithoutOffer: 0, onTripWithoutRide: 0 };
    for (const offerId of await this.offers.lostTimers(RECONCILE_BATCH)) {
      if (await this.safely(`expire ${offerId}`, () => this.expire(offerId))) counts.lostTimers++;
    }
    for (const rideId of await this.offers.staleOffers(RECONCILE_BATCH)) {
      if (await this.safely(`sync ${rideId}`, () => this.sync(rideId))) counts.staleOffers++;
    }
    const drifts = [
      ['reservedWithoutOffer', 'reserved', 'release'],
      ['onTripWithoutRide', 'on_trip', 'finish'],
    ] as const;
    for (const [key, state, action] of drifts) {
      for (const driverId of await this.offers.unbacked(state, RECONCILE_BATCH)) {
        const repaired = await this.safely(`${action} ${driverId}`, () =>
          this.db.transaction(
            async (m) => (await this.offers.lockIfUnbacked(m, driverId, state)) && this.drivers.move(m, driverId, action),
          ),
        );
        if (repaired) counts[key]++;
      }
    }
    if (Object.values(counts).some((n) => n > 0)) this.logger.warn(`reconciler repaired ${JSON.stringify(counts)}`);
    return counts;
  }

  // The retry for rides nobody could take yet, and the safety net for bookings whose sync job was lost
  async sweep(): Promise<void> {
    for (const rideId of await this.offers.searchingWithoutOffer(SWEEP_BATCH)) {
      await this.safely(`sync ${rideId}`, () => this.sync(rideId));
    }
  }

  // One bad item must not stop a batch: log it and move on, the next run tries it again.
  // True unless fn threw or returned false
  private async safely(what: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      return (await fn()) !== false;
    } catch (err) {
      this.logger.error(`${what} failed: ${(err as Error).message}`);
      return false;
    }
  }
}
