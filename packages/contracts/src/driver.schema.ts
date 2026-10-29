import { z } from 'zod';

// Remork = motorbike-pulled carriage; bajaj = auto-rickshaw
export const vehicleTypeSchema = z.enum(['moto', 'remork', 'bajaj']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const driverVerificationSchema = z.enum(['pending', 'verified', 'suspended', 'banned']);
export type DriverVerification = z.infer<typeof driverVerificationSchema>;

// shortcut: plate is free text (Cambodian formats vary by province); validate the format once admins review real data
export const applyDriverSchema = z.object({ vehicleType: vehicleTypeSchema, plate: z.string().trim().min(2).max(16) });
export type ApplyDriver = z.infer<typeof applyDriverSchema>;

// Stored on the driver (PLAN.md §4). Riders only ever see available drivers; the rest serves dispatch and support.
export const driverAvailabilitySchema = z.enum(['offline', 'available', 'reserved', 'on_trip']);
export type DriverAvailability = z.infer<typeof driverAvailabilitySchema>;

// go_* = the driver's toggle; reserve/release = an offer made/ended; assign = offer accepted; finish = ride ended
export const driverAvailabilityActionSchema = z.enum(['go_online', 'go_offline', 'reserve', 'release', 'assign', 'finish']);
export type DriverAvailabilityAction = z.infer<typeof driverAvailabilityActionSchema>;

export const driverProfileSchema = applyDriverSchema.extend({
  verification: driverVerificationSchema,
  availability: driverAvailabilitySchema,
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;

export const setAvailabilitySchema = z.object({ online: z.boolean() });
export type SetAvailability = z.infer<typeof setAvailabilitySchema>;

export const availabilitySchema = z.object({ availability: driverAvailabilitySchema });
export type Availability = z.infer<typeof availabilitySchema>;
