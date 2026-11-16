import type { CreateQuote, Quote, VehicleType } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { haversineMeters } from './domain/distance';
import { fare, type RateCard } from './domain/fare';
import { type BookableQuote, PricingRepository } from './pricing.repository';

const QUOTE_TTL_SECONDS = 300;

// shortcut: placeholder cards keep the pre-M6 prices; M6.2 replaces them with the versioned rate_cards table
const PLACEHOLDER_CARDS: Record<VehicleType, RateCard> = {
  moto: { base: 2000, perKm: 1000, perMin: 0, minimumFare: 0, bookingFee: 0 },
  bajaj: { base: 3000, perKm: 1300, perMin: 0, minimumFare: 0, bookingFee: 0 },
  remork: { base: 4000, perKm: 1500, perMin: 0, minimumFare: 0, bookingFee: 0 },
};

@Injectable()
export class PricingService {
  constructor(private readonly pricing: PricingRepository) {}

  async quote(riderId: string, input: CreateQuote): Promise<Quote> {
    const distanceM = haversineMeters(input.pickup, input.dropoff);
    // shortcut: no trip duration until OSRM quotes (M6.3), so perMin charges nothing yet
    const price = fare(PLACEHOLDER_CARDS[input.vehicleType], { distanceM, durationS: 0 });
    const { id, expiresAt } = await this.pricing.insertQuote(riderId, input, distanceM, price, QUOTE_TTL_SECONDS);
    return { id, vehicleType: input.vehicleType, distanceM, fare: price, expiresAt: expiresAt.toISOString() };
  }

  findQuote(riderId: string, quoteId: string): Promise<BookableQuote | undefined> {
    return this.pricing.findForRider(riderId, quoteId);
  }
}
