import { z } from 'zod';
import { moneySchema } from './money.schema';

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

// go_* = the driver's toggle; reserve/release = an offer made/ended; assign = offer accepted; finish = ride ended;
// debt_stop = ride ended past the commission debt limit; time_out = the presence sweep took a silent driver offline
export const driverAvailabilityActionSchema = z.enum([
  'go_online',
  'go_offline',
  'reserve',
  'release',
  'assign',
  'finish',
  'debt_stop',
  'time_out',
]);
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

// GET /drivers/me/earnings: Phnom Penh calendar dates, both inclusive; week mode widens them to whole ISO weeks
export const earningsQuerySchema = z
  .object({ by: z.enum(['day', 'week']), from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from >= '2000-01-01', 'from must be 2000 or later') // Postgres has no year 0
  .refine((q) => q.from <= q.to, 'from must not be after to')
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, 'at most 366 days');
export type EarningsQuery = z.infer<typeof earningsQuerySchema>;

// Non-empty buckets only, oldest first (the client zero-fills). KHR only: cents never add to riel.
// commission is what the ledger says the driver owes for those rides; earnings = fare - commission.
export const earningsSchema = z.object({
  buckets: z.array(
    z.object({
      start: z.iso.date(),
      rides: z.number().int().nonnegative(),
      fare: moneySchema,
      commission: moneySchema,
      earnings: moneySchema,
    }),
  ),
});
export type Earnings = z.infer<typeof earningsSchema>;
