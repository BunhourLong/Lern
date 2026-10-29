import { searchRadiusM } from './search-radius';

it.each([
  [0, 2000],
  [29.9, 2000],
  [30, 4000],
  [59.9, 4000],
  [60, 6000],
  [500, 6000],
])('searches %s s after booking within %i m', (elapsedS, radiusM) => {
  expect(searchRadiusM(elapsedS)).toBe(radiusM);
});
