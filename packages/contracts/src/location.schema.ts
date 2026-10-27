import { z } from 'zod';
import { pointSchema } from './geo.schema';

// Postgres rejects year 0 and zones beyond +-15:59 (a 500 / lost ack, and a retrying client never gets past it),
// so accept only real-world offsets (-12:00..+14:00) and instants from 2000 on.
const recordedAtSchema = z.iso.datetime({ offset: true }).refine((v) => {
  const zone = /([+-])(\d{2}):(\d{2})$/.exec(v);
  const offsetMin = zone ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) : 0;
  return offsetMin >= -12 * 60 && offsetMin <= 14 * 60 && Date.parse(v) >= Date.UTC(2000, 0, 1);
}, 'recordedAt out of range');

export const locationPointSchema = pointSchema.extend({ recordedAt: recordedAtSchema });
export type LocationPoint = z.infer<typeof locationPointSchema>;

export const recordLocationsSchema = z.object({ points: z.array(locationPointSchema).min(1).max(100) });
export type RecordLocations = z.infer<typeof recordLocationsSchema>;

// dropped = points more than 30 s ahead of server time
export const locationResultSchema = z.object({ dropped: z.number().int().nonnegative() });
export type LocationResult = z.infer<typeof locationResultSchema>;

export const DRIVER_LOCATION_EVENT = 'driver:location';
// Socket ack when the point is refused; the success ack is a LocationResult
export const socketErrorSchema = z.object({ error: z.enum(['BAD_REQUEST', 'FORBIDDEN']) });
export type SocketError = z.infer<typeof socketErrorSchema>;

// GET /drivers/nearby: query strings arrive as text
export const nearbyDriversQuerySchema = z.object({
  lat: z.coerce.number().pipe(pointSchema.shape.lat),
  lng: z.coerce.number().pipe(pointSchema.shape.lng),
});
export type NearbyDriversQuery = z.infer<typeof nearbyDriversQuerySchema>;

// Positions only, rounded to ~110 m and without ids, so a rider can't follow one driver between polls
export const nearbyDriversSchema = z.object({ drivers: z.array(pointSchema) });
export type NearbyDrivers = z.infer<typeof nearbyDriversSchema>;
