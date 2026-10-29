import type { Point } from '@lern/contracts';
import { haversineM } from './geo';

// Where a car is after driving `meters` along the route; done once it reaches the last point
export function positionAt(route: Point[], meters: number): { point: Point; done: boolean } {
  let left = meters;
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    const length = haversineM(a, b);
    if (left < length) {
      const f = left / length; // linear in degrees: fine over one road segment
      return { point: { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }, done: false };
    }
    left -= length;
  }
  return { point: route[route.length - 1], done: true };
}
