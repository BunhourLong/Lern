import { type ActiveRides, type CancelReason, type Ride, type RideAction, rideTransition } from '@lern/contracts';
import { ConflictException, GoneException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { PricingService } from '../pricing/pricing.service';
import { RidesRepository } from './rides.repository';

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
  constructor(
    private readonly pricing: PricingService,
    private readonly rides: RidesRepository,
  ) {}

  // The quote is immutable, so reading it outside the insert is safe; the uniques decide the races
  async book(riderId: string, quoteId: string): Promise<Ride> {
    const quote = await this.pricing.findQuote(riderId, quoteId);
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.expired) throw new GoneException('Quote expired, request a new one');
    try {
      return await this.rides.insert(riderId, { quoteId, ...quote });
    } catch (err) {
      throw conflict(err);
    }
  }

  // Open pool (until M4 offers): the guarded UPDATE decides which of many drivers wins
  accept(driverId: string, rideId: string): Promise<Ride> {
    return this.move(driverId, rideId, ['driver'], 'accept');
  }

  // arrive → start → complete, each only by the ride's assigned driver
  step(driverId: string, rideId: string, action: Extract<RideAction, 'arrive' | 'start' | 'complete'>): Promise<Ride> {
    return this.move(driverId, rideId, ['driver'], action);
  }

  // Either side may cancel, each from its own statuses (contracts table). Accept never assigns a ride's own
  // rider, so the caller is on at most one side and at most one of the two guarded UPDATEs can match.
  cancel(userId: string, rideId: string, reason: CancelReason): Promise<Ride> {
    return this.move(userId, rideId, ['rider', 'driver'], 'cancel', reason);
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
      let ride: Ride | undefined;
      try {
        ride = await this.rides.transition(userId, rideId, actor, action, t, cancelReason);
      } catch (err) {
        throw conflict(err);
      }
      if (ride) return ride;
    }
    // Only a participant gets the snapshot to reconcile with. Accept is the one action a non-participant
    // may try (open pool), so only it says that someone else's ride exists; every other action is a 404.
    const mine = await this.rides.findForParticipant(rideId, userId);
    if (!mine && (action !== 'accept' || !(await this.rides.exists(rideId)))) {
      throw new NotFoundException('Ride not found');
    }
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
