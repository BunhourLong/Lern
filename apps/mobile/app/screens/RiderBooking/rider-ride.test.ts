import type { Ride } from '@lern/contracts';
import {
  buildRiderRideMap,
  canRiderCancel,
  hasAssignedDriver,
  isEndedRiderRide,
  RIDER_PROGRESS_STEPS,
  riderCancelReasons,
  riderProgressIndex,
} from './rider-ride';

const progress = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
];
const searching = ['changed_mind', 'waited_too_long', 'other'];
const assigned = [
  'changed_mind',
  'waited_too_long',
  'driver_not_moving',
  'other',
];

test('orders the five progress stages by server status', () => {
  expect(RIDER_PROGRESS_STEPS).toEqual(progress);
});

test.each([
  ['searching', 0, false, false, searching],
  ['driver_assigned', 1, false, true, assigned],
  ['driver_arrived', 2, false, true, assigned],
  ['in_progress', 3, false, true, []],
  ['completed', 4, true, false, []],
  ['cancelled', undefined, true, false, []],
  ['no_driver_found', undefined, true, false, []],
] as const)(
  'derives rider state for %s',
  (status: Ride['status'], index, ended, driver, reasons) => {
    expect(riderProgressIndex(status)).toBe(index);
    expect(isEndedRiderRide(status)).toBe(ended);
    expect(hasAssignedDriver(status)).toBe(driver);
    expect(canRiderCancel(status)).toBe(reasons.length > 0);
    expect(riderCancelReasons(status)).toEqual(reasons);
  },
);

test('frames the route and adds a localized driver pin only when a position exists', () => {
  const pickup = { lat: 11, lng: 104 };
  const dropoff = { lat: 11.2, lng: 104.4 };
  const driverPosition = { lat: 10.8, lng: 104.6 };
  const labels = { pickup: 'A', dropoff: 'B', driver: 'C' };
  const route = buildRiderRideMap({
    pickup,
    dropoff,
    driverPosition: null,
    labels,
  });
  expect(route.pins).toEqual([
    { id: 'pickup', point: pickup, title: 'A', kind: 'rider' },
    { id: 'dropoff', point: dropoff, title: 'B', kind: 'dropoff' },
  ]);
  expect(route.center).toEqual({ lat: 11.1, lng: 104.2 });
  expect(route.delta).toBeCloseTo(0.72);

  const live = buildRiderRideMap({ pickup, dropoff, driverPosition, labels });
  expect(live.pins).toEqual([
    ...route.pins,
    { id: 'driver', point: driverPosition, title: 'C', kind: 'driver' },
  ]);
  expect(live.center).toEqual({ lat: 11, lng: 104.3 });
  expect(live.delta).toBeCloseTo(1.08);
});
