import type { CancelReason, Money, Point, Ride, RideAction, RideStatus, VehicleType } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const RIDE = `id, status, version, vehicle_type AS "vehicleType",
  json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
  json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff,
  json_build_object('amountMinor', fare_minor, 'currency', currency) AS fare`;

// Who may move a ride, checked inside the guarded UPDATE so a non-participant matches no row ($1 = caller)
const MAY_MOVE = {
  rider: 'rider_id = $1',
  driver: 'driver_id = $1',
  // shortcut: "available" = verified + no active ride; the availability state machine replaces it in M3/M4
  accept: 'rider_id <> $1 AND vehicle_type = (SELECT vehicle_type FROM drivers WHERE user_id = $1)',
};

export type NewRide = { quoteId: string; vehicleType: VehicleType; pickup: Point; dropoff: Point; fare: Money };

@Injectable()
export class RidesRepository {
  constructor(private readonly db: DataSource) {}

  // Throws a unique violation if the quote is already booked or the rider already has an active ride
  async insert(riderId: string, ride: NewRide): Promise<Ride> {
    const [row] = await this.db.query<Ride[]>(
      `WITH ride AS (
         INSERT INTO rides (rider_id, quote_id, vehicle_type, pickup, dropoff, fare_minor, currency)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9)
         RETURNING *
       ), event AS (
         INSERT INTO ride_events (ride_id, seq, status, actor, actor_id) SELECT id, version, status, 'rider', $1 FROM ride
       )
       SELECT ${RIDE} FROM ride`,
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

  // Invariant 1: one guarded statement moves the ride and logs the event, or matches nothing (undefined:
  // wrong status, or the caller may not move this ride). Accept also assigns the caller as the driver.
  // Throws a unique violation if that driver already has an active ride. A cancel needs its reason (a CHECK
  // rejects a cancelled ride without one); every other move leaves it NULL, as it already is.
  async transition(
    userId: string,
    rideId: string,
    actor: 'rider' | 'driver',
    action: RideAction,
    t: { from: readonly RideStatus[]; to: RideStatus },
    cancelReason?: CancelReason,
  ): Promise<Ride | undefined> {
    const accept = action === 'accept';
    const [row] = await this.db.query<Ride[]>(
      `WITH ride AS (
         UPDATE rides SET status = $4, version = version + 1, cancel_reason = $6${accept ? ', driver_id = $1' : ''}
         WHERE id = $2 AND status = ANY($3) AND ${MAY_MOVE[accept ? 'accept' : actor]}
         RETURNING *
       ), event AS (
         INSERT INTO ride_events (ride_id, seq, status, actor, actor_id) SELECT id, version, status, $5, $1 FROM ride
       )
       SELECT ${RIDE} FROM ride`,
      [userId, rideId, t.from, t.to, actor, cancelReason ?? null],
    );
    return row;
  }

  // Ownership lives in the WHERE: anyone but the ride's rider or assigned driver gets undefined
  async findForParticipant(rideId: string, userId: string): Promise<Ride | undefined> {
    const [row] = await this.db.query<Ride[]>(
      `SELECT ${RIDE} FROM rides WHERE id = $1 AND (rider_id = $2 OR driver_id = $2)`,
      [rideId, userId],
    );
    return row;
  }

  // The caller's ride on one side that hasn't ended; the partial uniques allow at most one per side
  async findActive(userId: string, side: 'rider_id' | 'driver_id'): Promise<Ride | undefined> {
    const [row] = await this.db.query<Ride[]>(
      `SELECT ${RIDE} FROM rides
       WHERE ${side} = $1 AND status IN ('searching', 'driver_assigned', 'driver_arrived', 'in_progress')`,
      [userId],
    );
    return row;
  }

  async exists(rideId: string): Promise<boolean> {
    return (await this.db.query<unknown[]>('SELECT 1 FROM rides WHERE id = $1', [rideId])).length === 1;
  }
}
