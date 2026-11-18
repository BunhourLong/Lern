import fc from 'fast-check';
import { ceilToRiel, fare, type RateCard } from './fare';

const C: RateCard = { base: 2000, perKm: 1000, perMin: 200, minimumFare: 5000, bookingFee: 500 };
const riel = (card: RateCard, distanceM: number, durationS: number) => fare(card, { distanceM, durationS }, 10_000).fare.amountMinor;

describe('fare (rate card, KHR)', () => {
  it('adds base, distance, time and booking fee in KHR', () => {
    expect(fare(C, { distanceM: 3000, durationS: 300 }, 10_000).fare).toEqual({ amountMinor: 6500, currency: 'KHR' });
  });

  it('rounds the exact total once, up to the next 100 riel', () => {
    // 2000 + 3001 + 1003.33 + 500 = 6504.33; rounding each part instead would give 6700
    expect(riel(C, 3001, 301)).toBe(6600);
  });

  it('charges the minimum fare for a short trip, plus the booking fee', () => {
    expect(riel(C, 1001, 90)).toBe(5500); // trip 3301 < minimum 5000
  });

  it('charges the base for a zero-length trip with no minimum or fee', () => {
    expect(riel({ ...C, minimumFare: 0, bookingFee: 0 }, 0, 0)).toBe(2000);
  });

  it.each(['base', 'perKm', 'perMin', 'minimumFare', 'bookingFee'])('refuses a negative %s', (name) => {
    expect(() => fare({ ...C, [name]: -1 }, { distanceM: 0, durationS: 0 }, 10_000)).toThrow(RangeError);
  });

  it('validates the card it prices with, even when the trip object carries a same-named key', () => {
    const trip = { distanceM: 0, durationS: 0, base: 0 };
    expect(() => fare({ ...C, base: -1 }, trip, 10_000)).toThrow(RangeError);
  });

  it.each([
    ['negative distance', C, -1, 0],
    ['fractional distance', C, 1.5, 0],
    ['negative duration', C, 0, -1],
    ['fractional duration', C, 0, 0.5],
    ['fractional card field', { ...C, perMin: 0.5 }, 0, 0],
    ['overflow', { ...C, perKm: Number.MAX_SAFE_INTEGER }, 1_000_000, 0],
    // the exact sum (×60000) passes 2^53 while the price (~2e11 riel) would still look safe
    ['inexact sum', { ...C, perKm: 100_000_000 }, 2_000_000, 0],
  ])('refuses a %s instead of producing a wrong price', (_name, card, distanceM, durationS) => {
    expect(() => fare(card, { distanceM, durationS }, 10_000)).toThrow(RangeError);
  });

  describe('surge', () => {
    const at = (card: RateCard, distanceM: number, durationS: number, surgeBp: number) => fare(card, { distanceM, durationS }, surgeBp);

    it('multiplies the trip, rounds the surged trip once, and lists whole-riel lines that sum to the fare', () => {
      // trip 2000 + 3001 + 1003.33 = 6004.33 → 6100; ×1.5 = 9006.5 → 9100; fee 500 on top
      expect(at(C, 3001, 301, 15_000)).toEqual({
        fare: { amountMinor: 9600, currency: 'KHR' },
        breakdown: { tripMinor: 6100, surgeMinor: 3000, bookingFeeMinor: 500 },
      });
    });

    it('surges a trip charged at the minimum fare', () => {
      // trip 3301 < minimum 5000; ×1.25 = 6250 → 6300
      expect(at(C, 1001, 90, 12_500)).toEqual({
        fare: { amountMinor: 6800, currency: 'KHR' },
        breakdown: { tripMinor: 5000, surgeMinor: 1300, bookingFeeMinor: 500 },
      });
    });

    it('never surges the booking fee', () => {
      // trip 6000 ×2 = 12000, fee 1000 unsurged (a surged fee would make 14000)
      expect(at({ ...C, bookingFee: 1000 }, 3000, 300, 20_000).fare.amountMinor).toBe(13_000);
    });

    it('charges the pre-surge price at 1.0x, with no surge line', () => {
      expect(at(C, 3001, 301, 10_000)).toEqual({
        fare: { amountMinor: 6600, currency: 'KHR' },
        breakdown: { tripMinor: 6100, surgeMinor: 0, bookingFeeMinor: 500 },
      });
    });

    it.each([9_999, 0, -10_000, 15_000.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a multiplier of %p bp', (surgeBp) => {
      expect(() => at(C, 3000, 300, surgeBp)).toThrow(RangeError);
    });

    it.each([50, 150, 1])('refuses a booking fee of %p riel (not a multiple of 100, so the lines could not sum)', (bookingFee) => {
      expect(() => at({ ...C, bookingFee }, 3000, 300, 10_000)).toThrow(RangeError);
    });

    it('prices at 1.0x every trip it priced before surge existed', () => {
      // trip 1.2e12 units is safe; × 10000 would not be
      expect(at({ ...C, base: 20_000_000 }, 0, 0, 10_000).fare.amountMinor).toBe(20_000_500);
    });

    it('refuses a surged trip past the safe integer range instead of producing a wrong price', () => {
      // 15001 shares no factor with 10000, so the numerator stays trip × 15001 ≈ 1.8e16
      expect(() => at({ ...C, base: 20_000_000 }, 0, 0, 15_001)).toThrow(RangeError);
    });
  });

  // Bounded so the surged trip (trip × 60000 × bp) stays a safe integer: past it fare() refuses (tested above)
  const field = fc.integer({ min: 0, max: 10_000 });
  const fee = fc.integer({ min: 0, max: 100 }).map((n) => n * 100);
  const card = fc.record({ base: field, perKm: field, perMin: field, minimumFare: field, bookingFee: fee });
  const distance = fc.integer({ min: 0, max: 200_000 });
  const duration = fc.integer({ min: 0, max: 10_000 });
  const surgeBp = fc.integer({ min: 10_000, max: 30_000 });
  const tripTimes60k = (c: RateCard, d: number, t: number) =>
    BigInt(Math.max(c.base * 60_000 + d * c.perKm * 60 + t * c.perMin * 1000, c.minimumFare * 60_000));

  it('lists whole-riel lines that sum to the fare, with the surged trip within 100 riel above the exact surged trip', () => {
    fc.assert(
      fc.property(card, distance, duration, surgeBp, (c, d, t, bp) => {
        const { fare: f, breakdown: b } = fare(c, { distanceM: d, durationS: t }, bp);
        expect(b.tripMinor + b.surgeMinor + b.bookingFeeMinor).toBe(f.amountMinor);
        expect(b.bookingFeeMinor).toBe(c.bookingFee);
        expect(b.surgeMinor >= 0 && b.surgeMinor % 100 === 0 && b.tripMinor % 100 === 0).toBe(true);
        const over = BigInt(b.tripMinor + b.surgeMinor) * 60_000n * 10_000n - tripTimes60k(c, d, t) * BigInt(bp);
        expect(over >= 0n && over < 100n * 60_000n * 10_000n).toBe(true);
      }),
    );
  });

  it('never decreases as the multiplier grows', () => {
    fc.assert(
      fc.property(card, distance, duration, surgeBp, surgeBp, (c, d, t, bp1, bp2) => {
        const price = (bp: number) => fare(c, { distanceM: d, durationS: t }, bp).fare.amountMinor;
        expect(price(Math.min(bp1, bp2))).toBeLessThanOrEqual(price(Math.max(bp1, bp2)));
      }),
    );
  });

  it('is a whole, non-negative multiple of 100 within 100 riel above the exact price', () => {
    fc.assert(
      fc.property(card, distance, duration, (c, d, t) => {
        const amount = riel(c, d, t);
        // exact price × 60000, independent of fare()'s internals
        const exact = tripTimes60k(c, d, t) + BigInt(c.bookingFee * 60_000);
        const over = BigInt(amount) * 60_000n - exact;
        expect(Number.isSafeInteger(amount) && amount >= 0 && amount % 100 === 0).toBe(true);
        expect(over >= 0n && over < 100n * 60_000n).toBe(true);
      }),
    );
  });

  it('never decreases as distance or duration grows', () => {
    fc.assert(
      fc.property(card, distance, distance, duration, duration, (c, d1, d2, t1, t2) => {
        expect(riel(c, Math.min(d1, d2), t1)).toBeLessThanOrEqual(riel(c, Math.max(d1, d2), t1));
        expect(riel(c, d1, Math.min(t1, t2))).toBeLessThanOrEqual(riel(c, d1, Math.max(t1, t2)));
      }),
    );
  });

  it('never charges less than the minimum fare plus the booking fee', () => {
    fc.assert(
      fc.property(card, distance, duration, (c, d, t) => {
        expect(riel(c, d, t)).toBeGreaterThanOrEqual(c.minimumFare + c.bookingFee);
      }),
    );
  });
});

describe('ceilToRiel', () => {
  it('rounds an exact fraction up to the next 100 riel', () => {
    expect(ceilToRiel(100 * 7, 7)).toBe(100);
    expect(ceilToRiel(1, 3)).toBe(100);
    expect(ceilToRiel(0, 7)).toBe(0);
  });

  it('leaves a multiple of 100 unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 100_000 }), (k, den) => {
        expect(ceilToRiel(k * 100 * den, den)).toBe(k * 100);
      }),
    );
  });

  it.each([
    [-1, 1],
    [1.5, 1],
    [1, 0],
    [1, 1.5],
    [Number.MAX_SAFE_INTEGER, 1], // rounds past the safe range
    [2 ** 53 + 2, 60_000], // unsafe numerator, safe-looking result
  ])('refuses %p / %p', (numerator, denominator) => {
    expect(() => ceilToRiel(numerator, denominator)).toThrow(RangeError);
  });
});
