import { z } from 'zod';

const stars = z.int().min(1).max(5);

// A blank comment is no comment: stored as null, like an omitted one
export const createRatingSchema = z.object({
  stars,
  comment: z
    .string()
    .trim()
    .max(500)
    // Postgres text rejects NUL: refuse it here, so the API answers 400 instead of failing the insert
    .refine((s) => !s.includes('\u0000'), 'Comment must not contain NUL')
    .transform((s) => s || null)
    .optional(),
});
export type CreateRating = z.infer<typeof createRatingSchema>;

export const ratingSchema = z.object({
  rideId: z.uuid(),
  stars,
  comment: z.string().nullable(),
});
export type Rating = z.infer<typeof ratingSchema>;
