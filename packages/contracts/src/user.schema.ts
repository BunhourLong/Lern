import { z } from 'zod';
import { phoneSchema } from './otp.schema';

// One user may hold several roles (a driver can also ride). Admin staff are not users: see admin-auth.schema
export const roleSchema = z.enum(['rider', 'driver']);
export type Role = z.infer<typeof roleSchema>;

export const meSchema = z.object({ id: z.uuid(), phone: phoneSchema, roles: z.array(roleSchema) });
export type Me = z.infer<typeof meSchema>;
