import { haversineM } from './geo';
import { positionAt } from './route-playback';

// ~111 m per 0.001° of latitude
const a = { lat: 11.55, lng: 104.92 };
const b = { lat: 11.551, lng: 104.92 };
const c = { lat: 11.551, lng: 104.921 };
const ab = haversineM(a, b);
const bc = haversineM(b, c);

describe('positionAt', () => {
  it('starts at the first point', () => {
    expect(positionAt([a, b, c], 0)).toEqual({ point: a, done: false });
  });

  it('interpolates inside a segment', () => {
    const { point, done } = positionAt([a, b, c], ab / 2);
    expect(done).toBe(false);
    expect(point.lat).toBeCloseTo(11.5505, 6);
    expect(point.lng).toBeCloseTo(104.92, 6);
  });

  it('carries the distance into later segments', () => {
    const { point } = positionAt([a, b, c], ab + bc / 4);
    expect(point.lat).toBeCloseTo(11.551, 6);
    expect(point.lng).toBeCloseTo(104.92025, 6);
  });

  it('is done at or past the end, on the last point', () => {
    expect(positionAt([a, b, c], ab + bc)).toEqual({ point: c, done: true });
    expect(positionAt([a, b, c], 1e9)).toEqual({ point: c, done: true });
  });

  it('is done at once on a one-point or zero-length route', () => {
    expect(positionAt([a], 5)).toEqual({ point: a, done: true });
    expect(positionAt([a, a], 0)).toEqual({ point: a, done: true });
  });
});

describe('haversineM', () => {
  it('measures ~111 m per 0.001° of latitude', () => {
    expect(ab).toBeGreaterThan(110);
    expect(ab).toBeLessThan(112);
  });
});
