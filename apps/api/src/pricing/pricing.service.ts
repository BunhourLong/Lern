import type { CreateQuote, Quote } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { commission, fare } from './domain/fare';
import { type BookableQuote, PricingRepository } from './pricing.repository';
import { RouteProvider } from './route.provider';
import { SurgeService } from './surge.service';

const QUOTE_TTL_SECONDS = 300;

@Injectable()
export class PricingService {
  constructor(
    private readonly pricing: PricingRepository,
    private readonly routes: RouteProvider,
    private readonly surge: SurgeService,
  ) {}

  async quote(riderId: string, input: CreateQuote): Promise<Quote> {
    // HTTP and Redis first, before any DB work: neither call holds a connection. Both are bounded and fall back
    // (straight line, 1.0x), so neither can fail the quote. Card and surge are snapshots: no transaction needed.
    const [route, surgeBp] = await Promise.all([
      this.routes.route(input.pickup, input.dropoff),
      this.surge.surgeBp(input.vehicleType, input.pickup),
    ]);
    const card = await this.pricing.activeCard(input.vehicleType);
    const price = fare(card, route, surgeBp);
    const { id, expiresAt } = await this.pricing.insertQuote(riderId, input, route, price, surgeBp, card.id, QUOTE_TTL_SECONDS);
    return { id, vehicleType: input.vehicleType, distanceM: route.distanceM, fare: price.fare, expiresAt: expiresAt.toISOString() };
  }

  // With the commission a ride on it owes: the quote's lines at its own card's rate, never the active card's
  async findQuote(
    riderId: string,
    quoteId: string,
  ): Promise<(Omit<BookableQuote, 'breakdown' | 'commissionBp'> & { commission: { bp: number; minor: number } }) | undefined> {
    const row = await this.pricing.findForRider(riderId, quoteId);
    if (!row) return undefined;
    const { breakdown, commissionBp, ...quote } = row;
    return { ...quote, commission: { bp: commissionBp, minor: commission(breakdown, commissionBp) } };
  }
}
