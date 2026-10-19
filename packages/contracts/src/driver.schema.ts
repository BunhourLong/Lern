import { z } from 'zod';

// Remork = motorbike-pulled carriage; bajaj = auto-rickshaw
export const vehicleTypeSchema = z.enum(['moto', 'remork', 'bajaj']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const driverVerificationSchema = z.enum(['pending', 'verified', 'suspended', 'banned']);
export type DriverVerification = z.infer<typeof driverVerificationSchema>;

// shortcut: plate is free text (Cambodian formats vary by province); validate the format once admins review real data
export const applyDriverSchema = z.object({ vehicleType: vehicleTypeSchema, plate: z.string().trim().min(2).max(16) });
export type ApplyDriver = z.infer<typeof applyDriverSchema>;

export const driverProfileSchema = applyDriverSchema.extend({ verification: driverVerificationSchema });
export type DriverProfile = z.infer<typeof driverProfileSchema>;
