import type { CreateQuote, Quote } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { haversineMeters } from './domain/distance';
import { fare } from './domain/fare';
import { PricingRepository } from './pricing.repository';

const QUOTE_TTL_SECONDS = 300;

@Injectable()
export class PricingService {
  constructor(private readonly pricing: PricingRepository) {}

  async quote(riderId: string, input: CreateQuote): Promise<Quote> {
    const distanceM = haversineMeters(input.pickup, input.dropoff);
    const price = fare(input.vehicleType, distanceM);
    const { id, expiresAt } = await this.pricing.insertQuote(riderId, input, distanceM, price, QUOTE_TTL_SECONDS);
    return { id, vehicleType: input.vehicleType, distanceM, fare: price, expiresAt: expiresAt.toISOString() };
  }
}
