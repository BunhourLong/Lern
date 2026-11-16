import type { CreateQuote, Quote } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { fare } from './domain/fare';
import { type BookableQuote, PricingRepository } from './pricing.repository';
import { RouteProvider } from './route.provider';

const QUOTE_TTL_SECONDS = 300;

@Injectable()
export class PricingService {
  constructor(
    private readonly pricing: PricingRepository,
    private readonly routes: RouteProvider,
  ) {}

  async quote(riderId: string, input: CreateQuote): Promise<Quote> {
    // HTTP first, before any DB work: the route call never holds a connection
    const route = await this.routes.route(input.pickup, input.dropoff);
    const card = await this.pricing.activeCard(input.vehicleType);
    const price = fare(card, route);
    const { id, expiresAt } = await this.pricing.insertQuote(riderId, input, route, price, card.id, QUOTE_TTL_SECONDS);
    return { id, vehicleType: input.vehicleType, distanceM: route.distanceM, fare: price, expiresAt: expiresAt.toISOString() };
  }

  findQuote(riderId: string, quoteId: string): Promise<BookableQuote | undefined> {
    return this.pricing.findForRider(riderId, quoteId);
  }
}
