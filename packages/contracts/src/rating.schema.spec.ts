import { createRatingSchema } from './rating.schema';

it('stores a blank comment as no comment, and keeps a real one', () => {
  expect(createRatingSchema.parse({ stars: 4, comment: '   ' }).comment).toBeNull();
  expect(createRatingSchema.parse({ stars: 4, comment: ' Good ' }).comment).toBe('Good');
  expect(createRatingSchema.parse({ stars: 4 }).comment).toBeUndefined();
});

it('applies the 500-character limit after trimming, and rejects a NUL byte', () => {
  expect(createRatingSchema.safeParse({ stars: 4, comment: `${' '.repeat(3)}${'x'.repeat(500)}` }).success).toBe(true);
  expect(createRatingSchema.safeParse({ stars: 4, comment: 'x'.repeat(501) }).success).toBe(false);
  expect(createRatingSchema.safeParse({ stars: 4, comment: 'a\u0000b' }).success).toBe(false);
});
