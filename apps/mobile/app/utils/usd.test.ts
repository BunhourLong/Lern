import { approxUsd } from './usd';

it.each([
  [5000, 4000, '≈ $1.25'],
  [0, 4000, '≈ $0.00'],
  [100, 4000, '≈ $0.03'], // 2.5¢ rounds half-up
  [99, 4000, '≈ $0.02'],
  [12000, 4100, '≈ $2.93'],
  [4_000_000, 4000, '≈ $1,000.00'],
  [4_000_000_000, 4000, '≈ $1,000,000.00'],
])('shows %i riel at %i per dollar as %s', (riel, khrPerUsd, expected) => {
  expect(approxUsd(riel, khrPerUsd)).toBe(expected);
});
