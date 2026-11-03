import { z } from 'zod';

export const pushPlatformSchema = z.enum(['android', 'ios']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

// FCM's token format is opaque and undocumented; the bound only stops a huge body from reaching the table
export const registerDeviceSchema = z.object({ token: z.string().min(1).max(4096), platform: pushPlatformSchema });
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;

// A push only says what to fetch: FCM data values are strings, and no pickup, dropoff or fare passes through Google.
// The app reads the snapshot over REST (invariant 8).
export type PushData = { type: 'offer'; rideId: string; offerId: string } | { type: 'ride'; rideId: string; seq: string };
