import type { DriverPosition, LocationPoint, LocationResult, Point } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type NearbyDriver = { driverId: string; distanceM: number; lat: number; lng: number };
// share = the point that moved the stored position forward and the rider who may see it, if any
export type Recorded = LocationResult & { share: (DriverPosition & { riderId: string }) | null };

@Injectable()
export class LocationRepository {
  constructor(private readonly db: DataSource) {}

  // One statement: verification check, future-point filter, newest-point pick, an upsert that only
  // moves forward in recorded_at (invariant 12), trip_points sampling while a ride is in_progress, and the
  // rider of the driver's active ride (from driver_assigned until it ends) to share the new position with.
  // No rows back = the caller is not a verified driver.
  async record(driverId: string, points: LocationPoint[]): Promise<Recorded | undefined> {
    const rows = await this.db.query<Recorded[]>(
      `WITH me AS (
         SELECT user_id FROM drivers WHERE user_id = $1 AND verification = 'verified'
       ), pts AS (
         SELECT lat, lng, recorded_at, recorded_at > now() + interval '30 seconds' AS future
         FROM unnest($2::float8[], $3::float8[], $4::timestamptz[]) AS p(lat, lng, recorded_at)
       ), newest AS (
         SELECT lat, lng, recorded_at FROM pts WHERE NOT future ORDER BY recorded_at DESC LIMIT 1
       ), up AS (
         INSERT INTO driver_locations (driver_id, position, recorded_at)
         SELECT me.user_id, ST_SetSRID(ST_MakePoint(newest.lng, newest.lat), 4326)::geography, newest.recorded_at
         FROM me, newest
         ON CONFLICT (driver_id) DO UPDATE
           SET position = EXCLUDED.position, recorded_at = EXCLUDED.recorded_at, received_at = now()
           WHERE driver_locations.recorded_at < EXCLUDED.recorded_at
         RETURNING 1
       ), active AS (
         SELECT rides.id, rides.rider_id FROM rides, me
         WHERE rides.driver_id = me.user_id AND rides.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       ), trip AS (
         SELECT rides.id FROM rides, me WHERE rides.driver_id = me.user_id AND rides.status = 'in_progress'
       ), sampled AS (
         -- shortcut: a batch that arrives after complete loses its tail; attribute by recorded_at if M5 shows late batches
         INSERT INTO trip_points (ride_id, position, recorded_at)
         SELECT trip.id, ST_SetSRID(ST_MakePoint(pts.lng, pts.lat), 4326)::geography, pts.recorded_at
         FROM trip, pts WHERE NOT pts.future
         ORDER BY pts.recorded_at
         ON CONFLICT (ride_id, date_bin('10 seconds', recorded_at, timestamptz '2000-01-01Z')) DO NOTHING
       )
       SELECT (SELECT count(*) FROM pts WHERE future)::int AS dropped,
              (SELECT json_build_object('riderId', active.rider_id, 'rideId', active.id, 'lat', newest.lat,
                        'lng', newest.lng, 'recordedAt', newest.recorded_at)
               FROM active, newest WHERE EXISTS (SELECT 1 FROM up)) AS share
       FROM me`,
      [driverId, points.map((p) => p.lat), points.map((p) => p.lng), points.map((p) => p.recordedAt)],
    );
    return rows[0];
  }

  // Fresh = received in the last 60 s by the server clock (a slow phone clock leaves recorded_at behind).
  // The point is inlined, not a CTE, so ORDER BY <-> can walk the GiST index.
  nearby(p: Point, radiusM: number, limit: number): Promise<NearbyDriver[]> {
    return this.db.query<NearbyDriver[]>(
      `SELECT l.driver_id AS "driverId",
              round(ST_Distance(l.position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography))::int AS "distanceM",
              ST_Y(l.position::geometry) AS lat, ST_X(l.position::geometry) AS lng
       FROM driver_locations l JOIN drivers d ON d.user_id = l.driver_id
       WHERE ST_DWithin(l.position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         AND l.received_at > now() - interval '60 seconds'
         AND d.verification = 'verified'
         -- shortcut: "available" = verified + no active ride, as in the open pool; the availability column replaces it in M4
         AND NOT EXISTS (
           SELECT 1 FROM rides r
           WHERE r.driver_id = l.driver_id AND r.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
         )
       ORDER BY l.position <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       LIMIT $4`,
      [p.lng, p.lat, radiusM, limit],
    );
  }
}
