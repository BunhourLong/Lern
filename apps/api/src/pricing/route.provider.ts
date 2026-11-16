import type { Point } from '@lern/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { haversineMeters } from './domain/distance';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';

// A quote holds no lock and no DB connection while it waits, so it can wait longer than matching's 1 s
const TIMEOUT_MS = 2000;
// Same average moto speed as matching's straight-line ETA guess
const FALLBACK_SPEED_MPS = 5;

// quotes.distance_m and duration_s are Postgres integers: a larger value would fail the insert instead of falling back
const measure = z.number().nonnegative().max(2_147_483_647);
const routeBody = z.object({ code: z.literal('Ok'), routes: z.array(z.object({ distance: measure, duration: measure })).min(1) });

export type Route = { distanceM: number; durationS: number };

// Road distance and duration from OSRM's route service (PLAN.md §2.4). Any failure quotes from the straight line
// instead: OSRM being down must not stop booking, and the quote is a snapshot the rider sees before booking.
@Injectable()
export class RouteProvider {
  private readonly logger = new Logger(RouteProvider.name);

  constructor(@Inject(PRICING_CONFIG) private readonly config: PricingConfig) {}

  async route(pickup: Point, dropoff: Point): Promise<Route> {
    try {
      const res = await fetch(
        `${this.config.OSRM_URL}/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=false`,
        // A redirect is not a 2xx answer from OSRM: fall back rather than price a route from elsewhere
        { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' },
      );
      const body = routeBody.safeParse(await res.json());
      if (res.ok && body.success) {
        const [{ distance, duration }] = body.data.routes;
        // OSRM sends fractional metres and seconds; fare() prices whole ones
        return { distanceM: Math.round(distance), durationS: Math.round(duration) };
      }
      this.logger.warn(`OSRM route unusable (HTTP ${res.status}), quoting from the straight line`);
    } catch (err) {
      this.logger.warn(`OSRM route failed (${(err as Error).name}), quoting from the straight line`);
    }
    const distanceM = haversineMeters(pickup, dropoff);
    return { distanceM, durationS: Math.round(distanceM / FALLBACK_SPEED_MPS) };
  }
}
