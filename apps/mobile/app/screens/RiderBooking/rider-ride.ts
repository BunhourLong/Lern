import {
  rideTransition,
  type CancelReason,
  type Point,
  type Ride,
} from '@lern/contracts';
import type { MapPin } from '../../components/AppMap';
import { frameMapPoints } from '../../components/map-region';
import type { useT } from '../../i18n';

export const RIDER_PROGRESS_STEPS = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
] as const satisfies readonly Ride['status'][];

export type RiderProgressStep = (typeof RIDER_PROGRESS_STEPS)[number];

export function riderProgressIndex(status: Ride['status']): number | undefined {
  const index = RIDER_PROGRESS_STEPS.findIndex(step => step === status);
  return index < 0 ? undefined : index;
}

export type EndedRiderRideStatus =
  | 'completed'
  | 'cancelled'
  | 'no_driver_found';

export function isEndedRiderRide(
  status: Ride['status'],
): status is EndedRiderRideStatus {
  return (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'no_driver_found'
  );
}

export function hasAssignedDriver(status: Ride['status']): boolean {
  return (
    status === 'driver_assigned' ||
    status === 'driver_arrived' ||
    status === 'in_progress'
  );
}

export function canRiderCancel(status: Ride['status']): boolean {
  return Boolean(rideTransition('cancel', 'rider')?.from.includes(status));
}

export const RIDER_CANCEL_REASONS = [
  'changed_mind',
  'waited_too_long',
  'driver_not_moving',
  'other',
] as const satisfies readonly CancelReason[];

export type RiderCancelReason = (typeof RIDER_CANCEL_REASONS)[number];

export function riderCancelReasons(
  status: Ride['status'],
): readonly RiderCancelReason[] {
  if (!canRiderCancel(status)) return [];
  return status === 'searching'
    ? RIDER_CANCEL_REASONS.filter(reason => reason !== 'driver_not_moving')
    : RIDER_CANCEL_REASONS;
}

export function buildRiderRideMap({
  pickup,
  dropoff,
  driverPosition,
  labels,
}: {
  pickup: Point;
  dropoff: Point;
  driverPosition: Point | null;
  labels: { pickup: string; dropoff: string; driver: string };
}) {
  const pins: MapPin[] = [
    { id: 'pickup', point: pickup, kind: 'rider', title: labels.pickup },
    { id: 'dropoff', point: dropoff, kind: 'dropoff', title: labels.dropoff },
  ];
  if (driverPosition)
    pins.push({
      id: 'driver',
      point: driverPosition,
      kind: 'driver',
      title: labels.driver,
    });
  return {
    ...frameMapPoints(
      driverPosition ? [pickup, dropoff, driverPosition] : [pickup, dropoff],
    ),
    pins,
  };
}

export function riderRideProgress(
  status: Ride['status'],
  t: ReturnType<typeof useT>,
) {
  const currentIndex = riderProgressIndex(status);
  if (currentIndex === undefined) return undefined;
  const steps = RIDER_PROGRESS_STEPS.map(key => ({
    key,
    label: t(`riderRide.stage.${key}`),
  }));
  return {
    steps,
    currentIndex,
    completed: status === 'completed',
    accessibilityLabel: t('riderRide.progressLabel', {
      step: currentIndex + 1,
      total: steps.length,
      stage: steps[currentIndex].label,
    }),
  };
}

export function riderRideMapLabels(t: ReturnType<typeof useT>) {
  return {
    pickup: t('driverRide.pin.pickup'),
    dropoff: t('driverRide.pin.dropoff'),
    driver: t('riderRide.pin.driver'),
  };
}
