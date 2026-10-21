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
