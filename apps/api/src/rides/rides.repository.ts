import type { Money, Point, Ride, VehicleType } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const RIDE = `id, status, version, vehicle_type AS "vehicleType",
  json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
  json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff,
  json_build_object('amountMinor', fare_minor, 'currency', currency) AS fare`;

export type NewRide = { quoteId: string; vehicleType: VehicleType; pickup: Point; dropoff: Point; fare: Money };

@Injectable()
export class RidesRepository {
  constructor(private readonly db: DataSource) {}

  // Throws a unique violation if the quote is already booked or the rider already has an active ride
  async insert(riderId: string, ride: NewRide): Promise<Ride> {
    const [row] = await this.db.query<Ride[]>(
      `INSERT INTO rides (rider_id, quote_id, vehicle_type, pickup, dropoff, fare_minor, currency)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9)
       RETURNING ${RIDE}`,
      [
        riderId,
        ride.quoteId,
        ride.vehicleType,
        ride.pickup.lng,
        ride.pickup.lat,
        ride.dropoff.lng,
        ride.dropoff.lat,
        ride.fare.amountMinor,
        ride.fare.currency,
      ],
    );
    return row;
  }
}
