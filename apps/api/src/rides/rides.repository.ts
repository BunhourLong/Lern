import {
  type CancelReason,
  type Money,
  type Point,
  RIDE_UPDATED_EVENT,
  type Ride,
  type RideAction,
  type RideActor,
  type RideStatus,
  type VehicleType,
} from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

const RIDE = `id, status, version, vehicle_type AS "vehicleType",
  json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
  json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff,
  json_build_object('amountMinor', fare_minor, 'currency', currency) AS fare`;

// Invariant 7: the statement that changes the ride also queues its announcement to both participants,
// carrying the same snapshot REST returns (invariant 8). OutboxService sends it after the caller's kick.
const OUTBOX = `outbox AS (
  INSERT INTO outbox_events (topic, recipients, payload)
  SELECT '${RIDE_UPDATED_EVENT}', array_remove(ARRAY[rider_id, driver_id], NULL), (SELECT to_jsonb(s) FROM (SELECT ${RIDE}) s)
  FROM ride
)`;

// Who may move a ride, checked inside the guarded UPDATE so a non-participant matches no row ($1 = caller,
// NULL for the system)
const MAY_MOVE = {
  rider: 'rider_id = $1',
  driver: 'driver_id = $1',
  system: '$1::uuid IS NULL',
  // Only through an accepted offer (matching), which already checked the driver
  accept: 'driver_id IS NULL',
};

export type NewRide = { quoteId: string; vehicleType: VehicleType; pickup: Point; dropoff: Point; fare: Money };
// driverId never reaches a client: @ZodSerializerDto(RideDto) strips unknown keys, and the outbox payload is the RIDE projection
export type MovedRide = Ride & { driverId: string | null };
export type MatchableRide = { status: RideStatus; riderId: string; vehicleType: VehicleType; pickup: Point; elapsedS: number };

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
       ), ${OUTBOX}
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

  // Invariant 1: one guarded statement moves the ride, logs the event and queues it in the outbox, or matches nothing (undefined:
  // wrong status, or the caller may not move this ride). Accept also assigns the caller as the driver. Returns the
  // ride's driver alongside the snapshot, for the availability move in the same transaction.
  // Throws a unique violation if that driver already has an active ride. A cancel needs its reason (a CHECK
  // rejects a cancelled ride without one); every other move leaves it NULL, as it already is.
  async transition(
    userId: string | null,
    rideId: string,
    actor: RideActor,
    action: RideAction,
    t: { from: readonly RideStatus[]; to: RideStatus },
    cancelReason?: CancelReason,
    m: EntityManager = this.db.manager,
  ): Promise<MovedRide | undefined> {
    const accept = action === 'accept';
    const [row] = await m.query<MovedRide[]>(
      `WITH ride AS (
         UPDATE rides SET status = $4, version = version + 1, cancel_reason = $6${accept ? ', driver_id = $1' : ''}
         WHERE id = $2 AND status = ANY($3) AND ${MAY_MOVE[accept ? 'accept' : actor]}
         RETURNING *
       ), event AS (
         INSERT INTO ride_events (ride_id, seq, status, actor, actor_id) SELECT id, version, status, $5, $1 FROM ride
       ), ${OUTBOX}
       SELECT ${RIDE}, driver_id AS "driverId" FROM ride`,
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

  // Locked until the caller's tx ends, so matching runs one sync per ride at a time; elapsed by the DB clock
  async lockForMatching(m: EntityManager, rideId: string): Promise<MatchableRide | undefined> {
    const [row] = await m.query<MatchableRide[]>(
      `SELECT status, rider_id AS "riderId", vehicle_type AS "vehicleType",
              json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
              extract(epoch FROM now() - created_at)::float AS "elapsedS"
       FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId],
    );
    return row;
  }
}
