import { haversineMeters } from './distance';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: 11.5564, lng: 104.9282 }, { lat: 11.5564, lng: 104.9282 })).toBe(0);
  });

  it('measures one degree of latitude as ~111.195 km, in whole metres', () => {
    expect(haversineMeters({ lat: 11, lng: 104.9 }, { lat: 12, lng: 104.9 })).toBe(111_195);
  });

  it('is symmetric', () => {
    // Independence Monument → Phnom Penh airport
    const a = { lat: 11.5564, lng: 104.9282 };
    const b = { lat: 11.5466, lng: 104.8441 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
    expect(haversineMeters(a, b)).toBeGreaterThan(9_000);
    expect(haversineMeters(a, b)).toBeLessThan(9_300);
  });
});
