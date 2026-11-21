import { cancelReasonSchema, type Ride } from '@lern/contracts';
import {
  canDriverCancel,
  DRIVER_CANCEL_REASONS,
  type DriverStepAction,
  isActiveDriverRide,
  nextDriverStep,
} from './driver-ride';

test.each<[Ride['status'], DriverStepAction | undefined, boolean]>([
  ['searching', undefined, false],
  ['driver_assigned', 'arrive', true],
  ['driver_arrived', 'start', true],
  ['in_progress', 'complete', false],
  ['completed', undefined, false],
  ['no_driver_found', undefined, false],
  ['cancelled', undefined, false],
])('%s allows step %s and cancellation %s', (status, step, cancel) => {
  expect(nextDriverStep(status)).toBe(step);
  expect(canDriverCancel(status)).toBe(cancel);
  expect(isActiveDriverRide(status)).toBe(step !== undefined);
});

test('offers only the driver cancellation reasons in display order', () => {
  expect(
    DRIVER_CANCEL_REASONS.map(reason => cancelReasonSchema.parse(reason)),
  ).toEqual([
    'rider_unreachable',
    'waited_too_long',
    'vehicle_problem',
    'changed_mind',
    'other',
  ]);
});
