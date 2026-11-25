import { translate } from '../../i18n';
import { formatOfferDistance, formatOfferFare } from './offer-format';

const t = translate.bind(undefined, 'en');

test.each([
  [0, '0 m'],
  [850, '850 m'],
  [999, '999 m'],
  [1000, '1.0 km'],
  [1150, '1.2 km'],
])('formats %i metres as %s', (distanceM, expected) => {
  expect(formatOfferDistance(distanceM, t)).toBe(expected);
});

test.each([
  [0, '0 ៛'],
  [12_000, '12,000 ៛'],
  [1_234_567, '1,234,567 ៛'],
])('groups %i riel as %s', (amountMinor, expected) => {
  expect(formatOfferFare({ amountMinor, currency: 'KHR' }, t)).toBe(expected);
});

test.each([
  [0, '$0.00'],
  [5, '$0.05'],
  [110, '$1.10'],
  [375, '$3.75'],
  [Number.MAX_SAFE_INTEGER, '$90071992547409.91'],
])('formats %i USD cents as %s', (amountMinor, expected) => {
  expect(formatOfferFare({ amountMinor, currency: 'USD' }, t)).toBe(expected);
});
