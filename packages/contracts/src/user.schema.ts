import { z } from 'zod';
import { phoneSchema } from './otp.schema';

// One user may hold several roles (a driver can also ride)
export const roleSchema = z.enum(['rider', 'driver', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const meSchema = z.object({ id: z.uuid(), phone: phoneSchema, roles: z.array(roleSchema) });
export type Me = z.infer<typeof meSchema>;
