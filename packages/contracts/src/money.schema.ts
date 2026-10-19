import { z } from 'zod';

// Integer minor units: USD in cents, KHR in riel (no minor unit). Never a float.
export const currencySchema = z.enum(['USD', 'KHR']);
export type Currency = z.infer<typeof currencySchema>;

export const moneySchema = z.object({ amountMinor: z.number().int().nonnegative(), currency: currencySchema });
export type Money = z.infer<typeof moneySchema>;
