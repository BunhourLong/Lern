import { z } from 'zod';
import { vehicleTypeSchema } from './driver.schema';
import { pointSchema } from './geo.schema';
import { moneySchema } from './money.schema';

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

// One user may hold both roles, and the two partial uniques allow one active ride on each side
export const activeRidesSchema = z.object({ rider: rideSchema.nullable(), driver: rideSchema.nullable() });
export type ActiveRides = z.infer<typeof activeRidesSchema>;
