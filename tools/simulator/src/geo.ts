import type { Point } from '@lern/contracts';

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: Point, b: Point): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Central Phnom Penh, both banks of the Tonle Sap
const BOX = { lat: [11.52, 11.6], lng: [104.86, 104.95] } as const;
export const randomPoint = (rand: () => number): Point => ({
  lat: BOX.lat[0] + rand() * (BOX.lat[1] - BOX.lat[0]),
  lng: BOX.lng[0] + rand() * (BOX.lng[1] - BOX.lng[0]),
});
