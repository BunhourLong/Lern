import { type ActiveRides, type CancelReason, type Ride, type RideAction, rideTransition } from '@lern/contracts';
import { ConflictException, GoneException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';
import { OutboxService } from '../outbox/outbox.service';
import { PricingService } from '../pricing/pricing.service';
import { DriversService } from '../drivers/drivers.service';
import { MatchingQueue } from '../shared/queue/matching-queue';
import { type MatchableRide, type MovedRide, RidesRepository } from './rides.repository';

const CONFLICTS: Record<string, string> = {
  rides_quote_id_key: 'Quote already booked',
  rides_one_active_per_rider: 'Rider already has an active ride',
  rides_one_active_per_driver: 'Driver already has an active ride',
};

// Maps a unique violation the schema uses to decide a race onto a 409; anything else is rethrown
function conflict(err: unknown): unknown {
  const constraint = err instanceof QueryFailedError ? (err.driverError as { constraint?: string }).constraint : undefined;
  return constraint && CONFLICTS[constraint] ? new ConflictException(CONFLICTS[constraint]) : err;
}

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly db: DataSource,
    private readonly drivers: DriversService,
    private readonly matching: MatchingQueue,
    private readonly outbox: OutboxService,
    private readonly pricing: PricingService,
    private readonly rides: RidesRepository,
  ) {}

  // The quote is immutable, so reading it outside the insert is safe; the uniques decide the races
  async book(riderId: string, quoteId: string): Promise<Ride> {
    const quote = await this.pricing.findQuote(riderId, quoteId);
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.expired) throw new GoneException('Quote expired, request a new one');
    let ride: Ride;
    try {
      ride = await this.rides.insert(riderId, { quoteId, ...quote });
    } catch (err) {
      throw conflict(err);
    }
    this.outbox.kick();
    this.match(ride.id);
    return ride;
  }

  // An accepted offer assigns its ride, inside matching's transaction (which kicks the outbox after commit).
  // Throws 409 if the driver already has an active ride (invariant 2).
  async assign(m: EntityManager, driverId: string, rideId: string): Promise<Ride | undefined> {
    try {
      return await this.rides.transition(driverId, rideId, 'driver', 'accept', rideTransition('accept', 'driver')!, undefined, m);
    } catch (err) {
      throw conflict(err);
    }
  }

  // arrive → start → complete, each only by the ride's assigned driver
  step(driverId: string, rideId: string, action: Extract<RideAction, 'arrive' | 'start' | 'complete'>): Promise<Ride> {
    return this.move(driverId, rideId, ['driver'], action);
  }

  // Either side may cancel, each from its own statuses (contracts table). Accept never assigns a ride's own
  // rider, so the caller is on at most one side and at most one of the two guarded UPDATEs can match.
  async cancel(userId: string, rideId: string, reason: CancelReason): Promise<Ride> {
    const ride = await this.move(userId, rideId, ['rider', 'driver'], 'cancel', reason);
    this.match(rideId); // ends its pending offer
    return ride;
  }

  // Matching's read of a ride, locked for the rest of its transaction
  lockForMatching(m: EntityManager, rideId: string): Promise<MatchableRide | undefined> {
    return this.rides.lockForMatching(m, rideId);
  }

  // The search deadline passed (invariant 1: guarded, by the system), inside matching's transaction.
  // The caller kicks the outbox after commit.
  async expire(m: EntityManager, rideId: string): Promise<boolean> {
    const t = rideTransition('expire', 'system')!;
    return (await this.rides.transition(null, rideId, 'system', 'expire', t, undefined, m)) !== undefined;
  }

  // Not awaited and never fails the request: the ride is committed, and a lost job is the sweep's to catch
  private match(rideId: string): void {
    this.matching.sync(rideId).catch((err: Error) => this.logger.warn(`sync of ${rideId} not queued: ${err.message}`));
  }

  private async move(
    userId: string,
    rideId: string,
    actors: readonly ('rider' | 'driver')[],
    action: RideAction,
    cancelReason?: CancelReason,
  ): Promise<Ride> {
    for (const actor of actors) {
      const t = rideTransition(action, actor);
      if (!t) throw new Error(`No ${action} transition for ${actor}`);
      let row: MovedRide | undefined;
      try {
        row = await this.db.transaction(async (m) => {
          const moved = await this.rides.transition(userId, rideId, actor, action, t, cancelReason, m);
          // A ride that ends frees its driver. A driver who isn't on_trip has drifted: the move misses, the ride
          // change still stands, and the reconciler repairs the driver.
          if (moved?.driverId && (moved.status === 'completed' || moved.status === 'cancelled')) {
            await this.drivers.move(m, moved.driverId, 'finish');
          }
          return moved;
        });
      } catch (err) {
        throw conflict(err);
      }
      if (row) {
        this.outbox.kick();
        return row;
      }
    }
    // Only a participant gets the snapshot to reconcile with; anyone else can't tell the ride exists
    const mine = await this.rides.findForParticipant(rideId, userId);
    if (!mine) throw new NotFoundException('Ride not found');
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      code: 'INVALID_TRANSITION',
      message: `Ride can't ${action} from its current status`,
      ride: mine,
    });
  }

  async get(userId: string, rideId: string): Promise<Ride> {
    const ride = await this.rides.findForParticipant(rideId, userId);
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  async active(userId: string): Promise<ActiveRides> {
    const [rider, driver] = await Promise.all([
      this.rides.findActive(userId, 'rider_id'),
      this.rides.findActive(userId, 'driver_id'),
    ]);
    return { rider: rider ?? null, driver: driver ?? null };
  }
}
