import { z } from 'zod';

const noNul = (s: string) => !s.includes('\0');

// Staff sign in with email + password on the admin web app; they are never app users (no phone, no role)
export const staffEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine(noNul, 'Must not contain a NUL byte')
  .pipe(z.email());

export const staffLoginSchema = z.object({
  email: staffEmailSchema,
  password: z.string().min(1).max(128).refine(noNul, 'Must not contain a NUL byte'),
});
export type StaffLogin = z.infer<typeof staffLoginSchema>;

export const staffSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  isSuperAdmin: z.boolean(),
});
export type StaffSummary = z.infer<typeof staffSummarySchema>;

// The session token travels only in the HttpOnly cookie; the body carries the CSRF token the page must echo
export const staffLoginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('authenticated'), staff: staffSummarySchema, csrfToken: z.string().min(1) }),
  z.object({ status: z.literal('mfa_required'), redirectUrl: z.string().min(1) }),
]);
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;

export const staffMeResponseSchema = z.object({ staff: staffSummarySchema, csrfToken: z.string().min(1) });
export type StaffMeResponse = z.infer<typeof staffMeResponseSchema>;

// The admin page posts what Duo appended to its redirect back (state, duo_code); Duo bounds state to 22–1024 characters
export const staffMfaCallbackSchema = z.object({
  state: z.string().min(22).max(1024).refine(noNul, 'Must not contain a NUL byte'),
  code: z.string().min(1).max(2048).refine(noNul, 'Must not contain a NUL byte'),
});
export type StaffMfaCallback = z.infer<typeof staffMfaCallbackSchema>;
