import { z } from 'zod';

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
