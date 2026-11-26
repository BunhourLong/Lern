import {
  pointSchema,
  type Point,
  type Quote,
  type Ride,
  type VehicleType,
} from '@lern/contracts';
import type { useT } from '../../i18n';
import { formatFare } from '../../utils/trip-format';
import { approxUsd } from '../../utils/usd';

export const PHNOM_PENH_PRESETS = [
  { id: 'independence', point: { lat: 11.5564, lng: 104.9282 } },
  { id: 'central_market', point: { lat: 11.5696, lng: 104.9211 } },
  { id: 'russian_market', point: { lat: 11.5407, lng: 104.9144 } },
  { id: 'riverside', point: { lat: 11.5685, lng: 104.9317 } },
] as const;

export type PresetId = (typeof PHNOM_PENH_PRESETS)[number]['id'];
export const VEHICLE_TYPES: readonly VehicleType[] = [
  'moto',
  'remork',
  'bajaj',
];

export function isWithinServiceArea(point: Point): boolean {
  return pointSchema.safeParse(point).success;
}

export function isSamePoint(a: Point, b: Point): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

export function formatPoint(point: Point): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

export function findPresetId(point: Point): PresetId | undefined {
  return PHNOM_PENH_PRESETS.find(preset => isSamePoint(point, preset.point))
    ?.id;
}

export type ActiveRiderRideStatus =
  | 'searching'
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress';

export function isActiveRiderRide(
  status: Ride['status'],
): status is ActiveRiderRideStatus {
  return (
    status === 'searching' ||
    status === 'driver_assigned' ||
    status === 'driver_arrived' ||
    status === 'in_progress'
  );
}

export function remainingQuoteSeconds(expiresAt: string, now: number): number {
  // shortcut: The device clock may be skewed; the server still enforces expiry (410) on book.
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function formatQuotePrice(
  fare: Quote['fare'],
  khrPerUsd: number | null,
  t: ReturnType<typeof useT>,
): { primary: string; approxUsd?: string } {
  const primary = formatFare(fare, t);
  return fare.currency === 'KHR' && khrPerUsd !== null && khrPerUsd > 0
    ? { primary, approxUsd: approxUsd(fare.amountMinor, khrPerUsd) }
    : { primary };
}
