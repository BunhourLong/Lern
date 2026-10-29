import { z } from 'zod';
import { vehicleTypeSchema } from './driver.schema';
import { pointSchema } from './geo.schema';
import { moneySchema } from './money.schema';

export const offerStatusSchema = z.enum(['pending', 'accepted', 'declined', 'expired', 'cancelled']);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

// A ride offered to one driver until expiresAt (server time). Carries what the driver needs to decide.
export const offerSchema = z.object({
  id: z.uuid(),
  rideId: z.uuid(),
  status: offerStatusSchema,
  expiresAt: z.iso.datetime(),
  distanceM: z.number().int().nonnegative(),
  vehicleType: vehicleTypeSchema,
  pickup: pointSchema,
  dropoff: pointSchema,
  fare: moneySchema,
});
export type Offer = z.infer<typeof offerSchema>;

// Server push to the offer's driver only, as the full Offer: when it's made (pending) and when it ends without
// the driver (expired, cancelled). Status orders the events: pending never follows a final status.
export const OFFER_UPDATED_EVENT = 'offer:updated';
