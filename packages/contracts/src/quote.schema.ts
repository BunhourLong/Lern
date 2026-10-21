import { z } from 'zod';
import { vehicleTypeSchema } from './driver.schema';
import { pointSchema } from './geo.schema';
import { moneySchema } from './money.schema';

export const createQuoteSchema = z.object({ pickup: pointSchema, dropoff: pointSchema, vehicleType: vehicleTypeSchema });
export type CreateQuote = z.infer<typeof createQuoteSchema>;

// Book with POST /rides before expiresAt (server time); after that, ask for a new quote
export const quoteSchema = z.object({
  id: z.uuid(),
  vehicleType: vehicleTypeSchema,
  distanceM: z.number().int().nonnegative(),
  fare: moneySchema,
  expiresAt: z.iso.datetime(),
});
export type Quote = z.infer<typeof quoteSchema>;
