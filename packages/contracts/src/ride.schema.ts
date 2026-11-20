import { z } from 'zod';
import { vehicleTypeSchema } from './driver.schema';
import { pointSchema } from './geo.schema';
import { moneySchema } from './money.schema';
import { offerSchema } from './offer.schema';

export const rideStatusSchema = z.enum([
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
  'no_driver_found',
  'cancelled',
]);
export type RideStatus = z.infer<typeof rideStatusSchema>;

export const rideActionSchema = z.enum(['accept', 'arrive', 'start', 'complete', 'expire', 'cancel']);
export type RideAction = z.infer<typeof rideActionSchema>;

// system = server timers/jobs (search deadline); admin actions arrive in M7
export const rideActorSchema = z.enum(['rider', 'driver', 'system']);
export type RideActor = z.infer<typeof rideActorSchema>;

export const createRideSchema = z.object({ quoteId: z.uuid() });
export type CreateRide = z.infer<typeof createRideSchema>;

// version is the ride's seq: realtime events carry it, and clients drop anything not newer than what they hold
export const rideSchema = z.object({
  id: z.uuid(),
  status: rideStatusSchema,
  version: z.number().int().positive(),
  vehicleType: vehicleTypeSchema,
  pickup: pointSchema,
  dropoff: pointSchema,
  fare: moneySchema,
});
export type Ride = z.infer<typeof rideSchema>;

// Server push to the ride's participants on every change; the payload is the full Ride (invariant 8)
export const RIDE_UPDATED_EVENT = 'ride:updated';

// Required on every cancel: a fixed list stays reportable and can't hold typed-in personal data.
// Who cancelled is the ride event's actor. The DB CHECK repeats this list: a new reason needs a migration.
export const cancelReasonSchema = z.enum([
  'changed_mind',
  'waited_too_long',
  'driver_not_moving',
  'rider_unreachable',
  'vehicle_problem',
  'other',
]);
export type CancelReason = z.infer<typeof cancelReasonSchema>;

export const cancelRideSchema = z.object({ reason: cancelReasonSchema });
export type CancelRide = z.infer<typeof cancelRideSchema>;

// The reconnect snapshot (PLAN.md M5): one user may hold both roles, and the two partial uniques allow one active
// ride on each side; offer = the caller's pending, unexpired offer as a driver. Optional only so a snapshot from
// before M5 still parses.
export const activeRidesSchema = z.object({
  rider: rideSchema.nullable(),
  driver: rideSchema.nullable(),
  offer: offerSchema.nullish(),
});
export type ActiveRides = z.infer<typeof activeRidesSchema>;

// GET /rides: the caller's finished rides on one side (rider or driver), newest first. Query strings arrive as text;
// cursor is an opaque token the server made, and limit defaults to 20 (one page, at most 50).
export const rideHistoryQuerySchema = z.object({
  as: z.enum(['rider', 'driver']),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RideHistoryQuery = z.infer<typeof rideHistoryQuerySchema>;

// createdAt is the ride's created_at as ISO-8601 UTC, in ms
export const rideHistoryItemSchema = rideSchema.extend({ createdAt: z.iso.datetime() });
export type RideHistoryItem = z.infer<typeof rideHistoryItemSchema>;

export const rideHistoryPageSchema = z.object({
  items: z.array(rideHistoryItemSchema),
  nextCursor: z.string().nullable(),
});
export type RideHistoryPage = z.infer<typeof rideHistoryPageSchema>;

// GET /rides/:id/receipt: built from the ride's stored quote and commission snapshots. driver is set only for the driver.
export const receiptSchema = z.object({
  rideId: z.uuid(),
  vehicleType: vehicleTypeSchema,
  pickup: pointSchema,
  dropoff: pointSchema,
  completedAt: z.iso.datetime(), // the ride's `completed` ride_events row, ISO-8601 UTC, ms
  distanceM: z.number().int().nonnegative(), // the quote's route estimate (no measured trip exists)
  durationS: z.number().int().nonnegative(),
  surgeBp: z.number().int().min(10000),
  lines: z.object({ trip: moneySchema, surge: moneySchema, bookingFee: moneySchema }),
  total: moneySchema,
  driver: z.object({ commission: moneySchema, earnings: moneySchema }).nullable(),
});
export type Receipt = z.infer<typeof receiptSchema>;
