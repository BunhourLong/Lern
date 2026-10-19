import type { Ride } from '@lern/contracts';
import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { PricingService } from '../pricing/pricing.service';
import { RidesRepository } from './rides.repository';

const CONFLICTS: Record<string, string> = {
  rides_quote_id_key: 'Quote already booked',
  rides_one_active_per_rider: 'Rider already has an active ride',
};

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
      const constraint = err instanceof QueryFailedError ? (err.driverError as { constraint?: string }).constraint : undefined;
      if (constraint && CONFLICTS[constraint]) throw new ConflictException(CONFLICTS[constraint]);
      throw err;
    }
  }
}
