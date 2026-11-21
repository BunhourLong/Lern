import { frameMapRegion } from './map-region';

const target = { lat: 11, lng: 104 };

test('centers on the target with the default zoom while the position is unknown', () => {
  expect(frameMapRegion(target, null)).toEqual({
    center: target,
    delta: 0.008,
  });
});

test.each([
  [{ lat: 11.001, lng: 104.001 }, { lat: 11.0005, lng: 104.0005 }, 0.008],
  [{ lat: 11.25, lng: 104.5 }, { lat: 11.125, lng: 104.25 }, 0.9],
  [{ lat: 13, lng: 104.5 }, { lat: 12, lng: 104.25 }, 2],
])(
  'frames both points using the greater axis span and clamps zoom (%j)',
  (driver, center, delta) => {
    const actual = frameMapRegion(target, driver);
    expect(actual.center.lat).toBeCloseTo(center.lat, 10);
    expect(actual.center.lng).toBeCloseTo(center.lng, 10);
    expect(actual.delta).toBeCloseTo(delta, 10);
  },
);
