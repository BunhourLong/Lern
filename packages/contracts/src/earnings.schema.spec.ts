import { earningsQuerySchema } from './driver.schema';

const ok = (q: object) => earningsQuerySchema.safeParse(q).success;

it('takes a day or week grouping between two real dates', () => {
  expect(ok({ by: 'day', from: '2026-11-11', to: '2026-11-11' })).toBe(true);
  expect(ok({ by: 'week', from: '2026-11-11', to: '2026-11-20' })).toBe(true);
  expect(ok({ from: '2026-11-11', to: '2026-11-11' })).toBe(false);
  expect(ok({ by: 'month', from: '2026-11-11', to: '2026-11-11' })).toBe(false);
  expect(ok({ by: 'day', from: '2026-02-30', to: '2026-03-01' })).toBe(false);
});

it('rejects from after to, a span past 366 days, and dates before 2000', () => {
  expect(ok({ by: 'day', from: '2026-11-12', to: '2026-11-11' })).toBe(false);
  expect(ok({ by: 'day', from: '2026-01-01', to: '2027-01-02' })).toBe(true);
  expect(ok({ by: 'day', from: '2026-01-01', to: '2027-01-03' })).toBe(false);
  expect(ok({ by: 'day', from: '2028-02-28', to: '2029-02-28' })).toBe(true); // leap year: 366 days
  expect(ok({ by: 'day', from: '1999-12-31', to: '2000-01-01' })).toBe(false);
});
