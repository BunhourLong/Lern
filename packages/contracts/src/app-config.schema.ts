import { z } from 'zod';

// Dotted numeric app version as the stores show it: Android versionName, iOS CFBundleShortVersionString (1.0, 1.2.3)
export const appVersionSchema = z.string().regex(/^\d+(\.\d+){0,2}$/);
export const storeUrlSchema = z.url({ protocol: /^https$/ });
// null = no minimum on that platform
const platformSchema = z.object({ minVersion: appVersionSchema, storeUrl: storeUrlSchema }).nullable();
export const appConfigSchema = z.object({ maintenance: z.boolean(), ios: platformSchema, android: platformSchema });
export type AppConfig = z.infer<typeof appConfigSchema>;
