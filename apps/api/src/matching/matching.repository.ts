import { OFFER_UPDATED_EVENT, type Offer, type Point, type VehicleType } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

// The Offer contract, built from an offer row `o` and its ride `r`; expiresAt as ISO-8601 UTC
const OFFER = `json_build_object(
  'id', o.id, 'rideId', o.ride_id, 'status', o.status,
  'expiresAt', to_char(o.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'distanceM', o.distance_m, 'vehicleType', r.vehicle_type,
  'pickup', json_build_object('lat', ST_Y(r.pickup::geometry), 'lng', ST_X(r.pickup::geometry)),
  'dropoff', json_build_object('lat', ST_Y(r.dropoff::geometry), 'lng', ST_X(r.dropoff::geometry)),
  'fare', json_build_object('amountMinor', r.fare_minor, 'currency', r.currency))`;

// Invariant 7: the statement that changes an offer (CTE `o`) also queues offer:updated to its driver
const OUTBOX = `outbox AS (
  INSERT INTO outbox_events (topic, recipients, payload)
  SELECT '${OFFER_UPDATED_EVENT}', ARRAY[o.driver_id], (${OFFER})::jsonb FROM o JOIN rides r ON r.id = o.ride_id
)`;

// Nearest candidates read per sync; EtaProvider reorders these by road ETA
const TOP_K = 5;

export type Candidate = Point & { driverId: string; distanceM: number };
export type RankedCandidate = Candidate & { etaS: number };

// What must exist for a driver (alias d) to be in each state
export type Unbackable = 'reserved' | 'on_trip';
const BACKING: Record<Unbackable, string> = {
  reserved: `SELECT 1 FROM ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'pending'`,
  on_trip: `SELECT 1 FROM rides r WHERE r.driver_id = d.user_id AND r.status IN ('driver_assigned', 'driver_arrived', 'in_progress')`,
};
export type CandidateQuery = { rideId: string; riderId: string; vehicleType: VehicleType; pickup: Point; radiusM: number };

@Injectable()
export class MatchingRepository {
  constructor(private readonly db: DataSource) {}

  async hasPending(m: EntityManager, rideId: string): Promise<boolean> {
    const rows = await m.query<unknown[]>(`SELECT 1 FROM ride_offers WHERE ride_id = $1 AND status = 'pending'`, [rideId]);
    return rows.length > 0;
  }

  // The nearest TOP_K fit drivers by straight line, unlocked: lockFirst takes the lock. Two statements on purpose:
  // FOR UPDATE on this join fails ("failed to fetch tuple for EvalPlanQual recheck") when a concurrent matcher
  // just reserved the row.
  async nearest(m: EntityManager, q: CandidateQuery): Promise<Candidate[]> {
    return m.query<Candidate[]>(
      `SELECT d.user_id AS "driverId",
              round(ST_Distance(l.position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography))::int AS "distanceM",
              ST_Y(l.position::geometry) AS lat, ST_X(l.position::geometry) AS lng
       FROM driver_locations l JOIN drivers d ON d.user_id = l.driver_id
       WHERE ST_DWithin(l.position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         AND l.received_at > now() - interval '60 seconds'
         AND d.verification = 'verified'
         AND d.availability = 'available'
         AND d.vehicle_type = $4
         AND d.user_id <> $5
         AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = $6 AND o.driver_id = d.user_id)
       ORDER BY l.position <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       LIMIT ${TOP_K}`,
      [q.pickup.lng, q.pickup.lat, q.radiusM, q.vehicleType, q.riderId, q.rideId],
    );
  }

  // Invariant 4: the first of driverIds (in that order) still available, row-locked until the caller's tx ends;
  // a driver another matcher holds is skipped, not waited for. Locking drivers alone re-checks its state
  // against the newest row version.
  async lockFirst(m: EntityManager, driverIds: string[]): Promise<string | undefined> {
    const [locked] = await m.query<{ driverId: string }[]>(
      `SELECT user_id AS "driverId" FROM drivers
       WHERE user_id = ANY($1::uuid[]) AND availability = 'available' AND verification = 'verified'
       ORDER BY array_position($1::uuid[], user_id)
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [driverIds],
    );
    return locked?.driverId;
  }

  async insert(m: EntityManager, rideId: string, c: RankedCandidate, ttlS: number): Promise<string> {
    const [row] = await m.query<{ id: string }[]>(
      `WITH o AS (
         INSERT INTO ride_offers (ride_id, driver_id, distance_m, eta_s, expires_at)
         VALUES ($1, $2, $3, $5, now() + make_interval(secs => $4))
         RETURNING *
       ), ${OUTBOX}
       SELECT id FROM o`,
      [rideId, c.driverId, c.distanceM, ttlS, c.etaS],
    );
    return row.id;
  }

  // The ride stopped searching: its pending offer (if any) ends; returns that offer's driver
  async cancelPending(m: EntityManager, rideId: string): Promise<string | undefined> {
    const [row] = await m.query<{ driverId: string }[]>(
      `WITH o AS (
         UPDATE ride_offers SET status = 'cancelled', responded_at = now()
         WHERE ride_id = $1 AND status = 'pending'
         RETURNING *
       ), ${OUTBOX}
       SELECT driver_id AS "driverId" FROM o`,
      [rideId],
    );
    return row?.driverId;
  }

  // Ownership lives in the WHERE: another driver's offer reads as not found
  async findForDriver(m: EntityManager, offerId: string, driverId: string): Promise<{ rideId: string } | undefined> {
    const [row] = await m.query<{ rideId: string }[]>(
      'SELECT ride_id AS "rideId" FROM ride_offers WHERE id = $1 AND driver_id = $2',
      [offerId, driverId],
    );
    return row;
  }

  // Invariant 3: only its driver, only while pending, only before expires_at by the DB clock
  async accept(m: EntityManager, offerId: string, driverId: string): Promise<boolean> {
    const [, count] = await m.query<[unknown, number]>(
      `UPDATE ride_offers SET status = 'accepted', responded_at = now()
       WHERE id = $1 AND driver_id = $2 AND status = 'pending' AND expires_at > now()`,
      [offerId, driverId],
    );
    return count === 1;
  }

  async decline(m: EntityManager, offerId: string, driverId: string): Promise<Offer | undefined> {
    const [row] = await m.query<{ offer: Offer }[]>(
      `WITH o AS (
         UPDATE ride_offers SET status = 'declined', responded_at = now()
         WHERE id = $1 AND driver_id = $2 AND status = 'pending'
         RETURNING *
       )
       SELECT ${OFFER} AS offer FROM o JOIN rides r ON r.id = o.ride_id`,
      [offerId, driverId],
    );
    return row?.offer;
  }

  async snapshot(offerId: string, driverId: string): Promise<Offer | undefined> {
    const [row] = await this.db.query<{ offer: Offer }[]>(
      `SELECT ${OFFER} AS offer FROM ride_offers o JOIN rides r ON r.id = o.ride_id WHERE o.id = $1 AND o.driver_id = $2`,
      [offerId, driverId],
    );
    return row?.offer;
  }

  // Only a pending offer past expires_at by the DB clock; returns its ride and driver
  async expire(m: EntityManager, offerId: string): Promise<{ rideId: string; driverId: string } | undefined> {
    const [row] = await m.query<{ rideId: string; driverId: string }[]>(
      `WITH o AS (
         UPDATE ride_offers SET status = 'expired', responded_at = now()
         WHERE id = $1 AND status = 'pending' AND expires_at <= now()
         RETURNING *
       ), ${OUTBOX}
       SELECT ride_id AS "rideId", driver_id AS "driverId" FROM o`,
      [offerId],
    );
    return row;
  }

  // Time left on a pending offer by the DB clock (at least 1 ms), or undefined once it has been answered
  async remainingMs(m: EntityManager, offerId: string): Promise<number | undefined> {
    const [row] = await m.query<{ ms: number }[]>(
      `SELECT GREATEST(ceil(extract(epoch FROM expires_at - now()) * 1000), 1)::int AS ms
       FROM ride_offers WHERE id = $1 AND status = 'pending'`,
      [offerId],
    );
    return row?.ms;
  }

  // Reconciler reads: rows a lost job (or a bug) left behind, bounded per run. A timer is the expected way out
  // of a pending offer, so only offers 5 s past due count as lost.
  async lostTimers(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ id: string }[]>(
      `SELECT id FROM ride_offers WHERE status = 'pending' AND expires_at < now() - interval '5 seconds'
       ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  async staleOffers(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ rideId: string }[]>(
      `SELECT o.ride_id AS "rideId" FROM ride_offers o JOIN rides r ON r.id = o.ride_id
       WHERE o.status = 'pending' AND r.status <> 'searching' LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.rideId);
  }

  async unbacked(state: Unbackable, limit: number): Promise<string[]> {
    const rows = await this.db.query<{ id: string }[]>(
      `SELECT user_id AS id FROM drivers d WHERE availability = $1 AND NOT EXISTS (${BACKING[state]}) LIMIT $2`,
      [state, limit],
    );
    return rows.map((r) => r.id);
  }

  // Locks the driver, then checks again in a new statement: in READ COMMITTED that one sees an offer or ride
  // committed while it waited for the lock (a NOT EXISTS inside the locking statement would not)
  async lockIfUnbacked(m: EntityManager, driverId: string, state: Unbackable): Promise<boolean> {
    const [locked] = await m.query<unknown[]>(
      'SELECT 1 FROM drivers d WHERE user_id = $1 AND availability = $2 FOR UPDATE',
      [driverId, state],
    );
    if (!locked) return false;
    const [backed] = await m.query<unknown[]>(`SELECT 1 FROM drivers d WHERE user_id = $1 AND EXISTS (${BACKING[state]})`, [
      driverId,
    ]);
    return !backed;
  }

  // Oldest first and bounded: a backlog drains over several ticks instead of one long one
  async searchingWithoutOffer(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ id: string }[]>(
      `SELECT r.id FROM rides r
       WHERE r.status = 'searching'
         AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = r.id AND o.status = 'pending')
       ORDER BY r.created_at LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }
}
