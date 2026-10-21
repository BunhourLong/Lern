export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_008.8; // mean radius
const rad = (deg: number) => (deg * Math.PI) / 180;

// Straight-line distance in whole metres; the placeholder until OSRM road distance (M6), then its fallback
export function haversineMeters(a: LatLng, b: LatLng): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}
