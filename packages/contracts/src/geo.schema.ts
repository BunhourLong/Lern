import { z } from 'zod';

// WGS84 point, bounded to a box around Cambodia (the service area) with a small margin
export const pointSchema = z.object({ lat: z.number().min(9.5).max(15), lng: z.number().min(102).max(108) });
export type Point = z.infer<typeof pointSchema>;
