import { z } from 'zod';

const status = z.enum(['up', 'down']);

export const healthSchema = z.object({ status: z.enum(['ok', 'error']), db: status, redis: status });
export type Health = z.infer<typeof healthSchema>;
