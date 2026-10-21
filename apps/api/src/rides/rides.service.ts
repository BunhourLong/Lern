import { type Ride, rideTransition } from '@lern/contracts';
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

const ACCEPT = rideTransition('accept', 'driver')!;

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
  async accept(driverId: string, rideId: string): Promise<Ride> {
    let ride: Ride | undefined;
    try {
      ride = await this.rides.accept(driverId, rideId, ACCEPT.from, ACCEPT.to);
    } catch (err) {
      throw conflict(err);
    }
    if (ride) return ride;
    const current = await this.rides.find(rideId);
    if (!current) throw new NotFoundException('Ride not found');
    const { driverId: assignee, ...snapshot } = current;
    // Only the assigned driver gets the snapshot to reconcile with; anyone else just learns it's gone
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      code: 'INVALID_TRANSITION',
      message: 'Ride can no longer be accepted',
      ride: assignee === driverId ? snapshot : undefined,
    });
  }
}
