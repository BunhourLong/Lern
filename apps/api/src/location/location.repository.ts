import type { LocationPoint, LocationResult } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class LocationRepository {
  constructor(private readonly db: DataSource) {}

  // One statement: verification check, future-point filter, newest-point pick, an upsert that only
  // moves forward in recorded_at (invariant 12), and trip_points sampling while a ride is in_progress.
  // No rows back = the caller is not a verified driver.
  async record(driverId: string, points: LocationPoint[]): Promise<LocationResult | undefined> {
    const rows = await this.db.query<LocationResult[]>(
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
       SELECT (SELECT count(*) FROM pts WHERE future)::int AS dropped FROM me`,
      [driverId, points.map((p) => p.lat), points.map((p) => p.lng), points.map((p) => p.recordedAt)],
    );
    return rows[0];
  }
}
