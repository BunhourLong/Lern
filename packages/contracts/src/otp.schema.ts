import { z } from 'zod';

// Cambodian number in E.164: +855, no trunk 0, 8–9 digits. Clients normalise "012 345 678" before sending.
export const phoneSchema = z.string().regex(/^\+855[1-9]\d{7,8}$/, 'Expected a Cambodian number like +85512345678');

export const requestOtpSchema = z.object({ phone: phoneSchema });
export type RequestOtp = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) });
export type VerifyOtp = z.infer<typeof verifyOtpSchema>;
