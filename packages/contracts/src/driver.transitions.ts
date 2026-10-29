import type { DriverAvailability, DriverAvailabilityAction } from './driver.schema';

// Single source of the driver availability machine (PLAN.md §4). The API turns each entry into one guarded
// `UPDATE drivers SET availability = to WHERE availability = from`, in the tx of the offer or ride change behind it.
const DRIVER_TRANSITIONS: Record<DriverAvailabilityAction, { from: DriverAvailability; to: DriverAvailability }> = {
  go_online: { from: 'offline', to: 'available' },
  go_offline: { from: 'available', to: 'offline' },
  reserve: { from: 'available', to: 'reserved' },
  release: { from: 'reserved', to: 'available' },
  assign: { from: 'reserved', to: 'on_trip' },
  finish: { from: 'on_trip', to: 'available' },
};

export function driverTransition(action: DriverAvailabilityAction): { from: DriverAvailability; to: DriverAvailability } {
  return DRIVER_TRANSITIONS[action];
}
