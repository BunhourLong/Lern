import { type CancelReason, type Ride, rideTransition } from '@lern/contracts';

export const DRIVER_STEP_ACTIONS = ['arrive', 'start', 'complete'] as const;
export type DriverStepAction = (typeof DRIVER_STEP_ACTIONS)[number];

export function nextDriverStep(
  status: Ride['status'],
): DriverStepAction | undefined {
  return DRIVER_STEP_ACTIONS.find(action =>
    rideTransition(action, 'driver')?.from.includes(status),
  );
}

export function canDriverCancel(status: Ride['status']): boolean {
  return Boolean(rideTransition('cancel', 'driver')?.from.includes(status));
}

export type ActiveDriverRideStatus =
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress';

export function isActiveDriverRide(
  status: Ride['status'],
): status is ActiveDriverRideStatus {
  return (
    status === 'driver_assigned' ||
    status === 'driver_arrived' ||
    status === 'in_progress'
  );
}

export const DRIVER_CANCEL_REASONS = [
  'rider_unreachable',
  'waited_too_long',
  'vehicle_problem',
  'changed_mind',
  'other',
] as const satisfies readonly CancelReason[];

export type DriverCancelReason = (typeof DRIVER_CANCEL_REASONS)[number];
