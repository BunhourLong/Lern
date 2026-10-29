import type { Point } from '@lern/contracts';

// A road route as points from `from` to `to`
export type Router = (from: Point, to: Point) => Promise<Point[]>;

export const osrmRouter =
  (base: string): Router =>
  async (from, to) => {
    const res = await fetch(
      `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
    );
    if (!res.ok) throw new Error(`OSRM route failed: HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
    if (body.code !== 'Ok' || !body.routes?.[0]) throw new Error(`OSRM route failed: ${body.code}`);
    return body.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  };
