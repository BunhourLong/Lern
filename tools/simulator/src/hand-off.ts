import type { Point } from '@lern/contracts';
import { haversineM } from './geo';

// Open pool until M4: the simulator gives each ride to its nearest idle driver by straight line
export function nearestIdle<D extends { idle: boolean; position: Point }>(drivers: D[], p: Point): D | undefined {
  let best: D | undefined;
  for (const d of drivers) if (d.idle && (!best || haversineM(d.position, p) < haversineM(best.position, p))) best = d;
  return best;
}
