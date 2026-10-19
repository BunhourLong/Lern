import { z } from 'zod';

// 32 random bytes, base64url
const refreshToken = z.string().regex(/^[\w-]{43}$/);

export const tokenPairSchema = z.object({ accessToken: z.string(), refreshToken });
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const refreshSessionSchema = z.object({ refreshToken });
export type RefreshSession = z.infer<typeof refreshSessionSchema>;
