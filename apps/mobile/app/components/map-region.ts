import type { Point } from '@lern/contracts';

export function frameMapRegion(
  target: Point,
  driver: Point | null,
): { center: Point; delta: number } {
  if (!driver) return { center: target, delta: 0.008 };

  const span = Math.max(
    Math.abs(target.lat - driver.lat),
    Math.abs(target.lng - driver.lng),
  );
  return {
    center: {
      lat: (target.lat + driver.lat) / 2,
      lng: (target.lng + driver.lng) / 2,
    },
    delta: Math.min(2, Math.max(0.008, span * 1.8)),
  };
}
