import type { CreateQuote, Money, Point, VehicleType } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { FareBreakdown, RateCard } from './domain/fare';
import type { Route } from './route.provider';

export type BookableQuote = {
  vehicleType: VehicleType;
  pickup: Point;
  dropoff: Point;
  fare: Money;
  expired: boolean;
  // The quote's receipt lines and its own card's rate, for the commission booking snapshots (invariant 6)
  breakdown: FareBreakdown;
  commissionBp: number;
};

export type SurgeSample = { kind: 'demand' | 'supply'; vehicleType: VehicleType; lat: number; lng: number };

@Injectable()
export class PricingRepository {
  constructor(private readonly db: DataSource) {}

  // The newest card already active by the database clock. Cards are append-only, so no lock: the quote
  // stores this id and the amount priced from it, and that row can never change afterwards.
  async activeCard(vehicleType: VehicleType): Promise<RateCard & { id: string }> {
    const [card] = await this.db.query<(RateCard & { id: string })[]>(
      `SELECT id, base, per_km AS "perKm", per_min AS "perMin", minimum_fare AS "minimumFare", booking_fee AS "bookingFee"
       FROM rate_cards WHERE vehicle_type = $1 AND active_from <= now()
       ORDER BY active_from DESC LIMIT 1`,
      [vehicleType],
    );
    if (!card) throw new Error(`No active rate card for ${vehicleType}`);
    return card;
  }

  // Expiry comes from the database clock, the same one POST /rides will check it against
  async insertQuote(
    riderId: string,
    input: CreateQuote,
    route: Route,
    price: { fare: Money; breakdown: FareBreakdown },
    surgeBp: number,
    rateCardId: string,
    ttlSeconds: number,
  ): Promise<{ id: string; expiresAt: Date }> {
    const [row] = await this.db.query<{ id: string; expiresAt: Date }[]>(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency,
                           surge_bp, breakdown, rate_card_id, expires_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10,
               $11, $12::jsonb, $13, now() + make_interval(secs => $14))
       RETURNING id, expires_at AS "expiresAt"`,
      [
        riderId,
        input.pickup.lng,
        input.pickup.lat,
        input.dropoff.lng,
        input.dropoff.lat,
        input.vehicleType,
        route.distanceM,
        route.durationS,
        price.fare.amountMinor,
        price.fare.currency,
        surgeBp,
        JSON.stringify(price.breakdown),
        rateCardId,
        ttlSeconds,
      ],
    );
    return row;
  }

  // Demand is distinct riders (newest pickup per rider and vehicle type, so a cancel-and-request counts once);
  // supply uses matching's own freshness and availability rule. Both 60 s windows are the database clock.
  async surgeSamples(): Promise<SurgeSample[]> {
    return this.db.query<SurgeSample[]>(
      `SELECT 'demand' AS kind, vehicle_type AS "vehicleType", ST_Y(pickup::geometry) AS lat, ST_X(pickup::geometry) AS lng
       FROM (SELECT DISTINCT ON (rider_id, vehicle_type) rider_id, vehicle_type, pickup
             FROM rides WHERE created_at > now() - interval '60 seconds'
             ORDER BY rider_id, vehicle_type, created_at DESC) newest
       UNION ALL
       SELECT 'supply', d.vehicle_type, ST_Y(l.position::geometry), ST_X(l.position::geometry)
       FROM driver_locations l JOIN drivers d ON d.user_id = l.driver_id
       WHERE l.received_at > now() - interval '60 seconds'
         AND d.verification = 'verified'
         AND d.availability = 'available'`,
    );
  }

  // Owner in the WHERE, so another rider's quote is indistinguishable from a missing one
  async findForRider(riderId: string, quoteId: string): Promise<BookableQuote | undefined> {
    const [row] = await this.db.query<BookableQuote[]>(
      `SELECT q.vehicle_type AS "vehicleType",
              json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
              json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff,
              json_build_object('amountMinor', amount_minor, 'currency', currency) AS fare,
              expires_at <= now() AS expired, breakdown, c.commission_bp AS "commissionBp"
       FROM quotes q JOIN rate_cards c ON c.id = q.rate_card_id
       WHERE q.id = $1 AND q.rider_id = $2`,
      [quoteId, riderId],
    );
    return row;
  }
}
