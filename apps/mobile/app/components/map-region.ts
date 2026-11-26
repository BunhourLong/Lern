import type { Point } from '@lern/contracts';

export function frameMapPoints(points: readonly [Point, ...Point[]]): {
  center: Point;
  delta: number;
} {
  const [first, ...rest] = points;
  let minLat = first.lat;
  let maxLat = first.lat;
  let minLng = first.lng;
  let maxLng = first.lng;
  for (const { lat, lng } of rest) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  return {
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
    delta: Math.min(2, Math.max(0.008, span * 1.8)),
  };
}

export function frameMapRegion(target: Point, driver: Point | null) {
  return frameMapPoints(driver ? [target, driver] : [target]);
}
