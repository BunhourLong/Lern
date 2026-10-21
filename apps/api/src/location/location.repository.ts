import type { LocationPoint, LocationResult } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class LocationRepository {
  constructor(private readonly db: DataSource) {}

  // One statement: verification check, future-point filter, newest-point pick and an upsert that
  // only moves forward in recorded_at (invariant 12). No rows back = the caller is not a verified driver.
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
       )
       SELECT (SELECT count(*) FROM pts WHERE future)::int AS dropped FROM me`,
      [driverId, points.map((p) => p.lat), points.map((p) => p.lng), points.map((p) => p.recordedAt)],
    );
    return rows[0];
  }
}
