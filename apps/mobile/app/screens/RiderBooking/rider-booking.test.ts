import { rideStatusSchema } from '@lern/contracts';
import { translate } from '../../i18n';
import {
  findPresetId,
  formatPoint,
  formatQuotePrice,
  isActiveRiderRide,
  isSamePoint,
  isWithinServiceArea,
  PHNOM_PENH_PRESETS,
  remainingQuoteSeconds,
  VEHICLE_TYPES,
} from './rider-booking';

const t = translate.bind(undefined, 'en');

test('provides the four Phnom Penh presets in order and matches their points', () => {
  expect(PHNOM_PENH_PRESETS.map(({ id }) => id)).toEqual([
    'independence',
    'central_market',
    'russian_market',
    'riverside',
  ]);
  for (const { id, point } of PHNOM_PENH_PRESETS) {
    expect(isWithinServiceArea(point)).toBe(true);
    expect(findPresetId({ ...point, lat: point.lat + 0.0000005 })).toBe(id);
  }
  expect(findPresetId({ lat: 12, lng: 105 })).toBeUndefined();
  expect(VEHICLE_TYPES).toEqual(['moto', 'remork', 'bajaj']);
});

test.each([
  [9.5, 102, true],
  [15, 108, true],
  [9.49999, 105, false],
  [15.00001, 105, false],
  [12, 101.99999, false],
  [12, 108.00001, false],
  [NaN, 105, false],
  [12, Infinity, false],
])('validates a service-area point at %s, %s', (lat, lng, valid) => {
  expect(isWithinServiceArea({ lat, lng })).toBe(valid);
});

test('compares both coordinates with a tolerance and displays four decimal places', () => {
  const point = { lat: 11.555555, lng: 104.92 };
  expect(isSamePoint(point, { lat: 11.5555555, lng: 104.9200005 })).toBe(true);
  expect(isSamePoint(point, { ...point, lat: 11.555557 })).toBe(false);
  expect(isSamePoint(point, { ...point, lng: 104.920002 })).toBe(false);
  expect(formatPoint(point)).toBe('11.5556, 104.9200');
});

test('only searching and assigned, arrived, and in-progress rides are active', () => {
  expect(rideStatusSchema.options.filter(isActiveRiderRide)).toEqual([
    'searching',
    'driver_assigned',
    'driver_arrived',
    'in_progress',
  ]);
});

test.each([
  [0, 3],
  [1500, 2],
  [2999, 1],
  [3000, 0],
  [3001, 0],
])(
  'rounds positive quote time up and clamps at zero at %i ms',
  (now, seconds) => {
    expect(remainingQuoteSeconds(new Date(3000).toISOString(), now)).toBe(
      seconds,
    );
  },
);

test.each([null, 0, -1])('omits approximate dollars at rate %s', rate => {
  expect(
    formatQuotePrice({ amountMinor: 5000, currency: 'KHR' }, rate, t),
  ).toEqual({
    primary: '5,000 ៛',
  });
});

test('shows approximate dollars only for a KHR fare', () => {
  expect(
    formatQuotePrice({ amountMinor: 5000, currency: 'KHR' }, 4000, t),
  ).toEqual({
    primary: '5,000 ៛',
    approxUsd: '≈ $1.25',
  });
  expect(
    formatQuotePrice({ amountMinor: 125, currency: 'USD' }, 4000, t),
  ).toEqual({
    primary: '$1.25',
  });
});
