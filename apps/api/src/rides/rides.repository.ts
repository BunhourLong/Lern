import type { Money, Point, Ride, RideStatus, VehicleType } from '@lern/contracts';
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

  // Guarded transition: undefined when the ride isn't in `from` any more or isn't open to this driver
  // (other vehicle type, own ride). Throws a unique violation if the driver already has an active ride.
  // shortcut: "available" = verified + no active ride; the availability state machine replaces it in M3/M4
  async accept(driverId: string, rideId: string, from: readonly RideStatus[], to: RideStatus): Promise<Ride | undefined> {
    const [rows] = await this.db.query<[Ride[], number]>(
      `UPDATE rides SET status = $4, driver_id = $1, version = version + 1
       WHERE id = $2 AND status = ANY($3) AND rider_id <> $1
         AND vehicle_type = (SELECT vehicle_type FROM drivers WHERE user_id = $1)
       RETURNING ${RIDE}`,
      [driverId, rideId, from, to],
    );
    return rows[0];
  }

  async find(rideId: string): Promise<(Ride & { driverId: string | null }) | undefined> {
    const [row] = await this.db.query<(Ride & { driverId: string | null })[]>(
      `SELECT ${RIDE}, driver_id AS "driverId" FROM rides WHERE id = $1`,
      [rideId],
    );
    return row;
  }
}
