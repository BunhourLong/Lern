import type { CreateQuote, Money } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class PricingRepository {
  constructor(private readonly db: DataSource) {}

  // Expiry comes from the database clock, the same one POST /rides will check it against
  async insertQuote(
    riderId: string,
    input: CreateQuote,
    distanceM: number,
    fare: Money,
    ttlSeconds: number,
  ): Promise<{ id: string; expiresAt: Date }> {
    const [row] = await this.db.query<{ id: string; expiresAt: Date }[]>(
      `INSERT INTO quotes (rider_id, pickup, dropoff, vehicle_type, distance_m, amount_minor, currency, expires_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, now() + make_interval(secs => $10))
       RETURNING id, expires_at AS "expiresAt"`,
      [
        riderId,
        input.pickup.lng,
        input.pickup.lat,
        input.dropoff.lng,
        input.dropoff.lat,
        input.vehicleType,
        distanceM,
        fare.amountMinor,
        fare.currency,
        ttlSeconds,
      ],
    );
    return row;
  }
}
