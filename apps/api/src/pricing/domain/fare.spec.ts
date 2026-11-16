import fc from 'fast-check';
import { ceilToRiel, fare, type RateCard } from './fare';

const C: RateCard = { base: 2000, perKm: 1000, perMin: 200, minimumFare: 5000, bookingFee: 500 };
const riel = (card: RateCard, distanceM: number, durationS: number) => fare(card, { distanceM, durationS }).amountMinor;

describe('fare (rate card, KHR)', () => {
  it('adds base, distance, time and booking fee in KHR', () => {
    expect(fare(C, { distanceM: 3000, durationS: 300 })).toEqual({ amountMinor: 6500, currency: 'KHR' });
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
    expect(() => fare({ ...C, [name]: -1 }, { distanceM: 0, durationS: 0 })).toThrow(RangeError);
  });

  it('validates the card it prices with, even when the trip object carries a same-named key', () => {
    const trip = { distanceM: 0, durationS: 0, base: 0 };
    expect(() => fare({ ...C, base: -1 }, trip)).toThrow(RangeError);
  });

  it.each([
    ['negative distance', C, -1, 0],
    ['fractional distance', C, 1.5, 0],
    ['negative duration', C, 0, -1],
    ['fractional duration', C, 0, 0.5],
    ['fractional card field', { ...C, perMin: 0.5 }, 0, 0],
    ['overflow', { ...C, perKm: Number.MAX_SAFE_INTEGER }, 1_000_000, 0],
  ])('refuses a %s instead of producing a wrong price', (_name, card, distanceM, durationS) => {
    expect(() => fare(card, { distanceM, durationS })).toThrow(RangeError);
  });

  const field = fc.integer({ min: 0, max: 1_000_000 });
  const card = fc.record({ base: field, perKm: field, perMin: field, minimumFare: field, bookingFee: field });
  const distance = fc.integer({ min: 0, max: 2_000_000 });
  const duration = fc.integer({ min: 0, max: 100_000 });

  it('is a whole, non-negative multiple of 100 within 100 riel above the exact price', () => {
    fc.assert(
      fc.property(card, distance, duration, (c, d, t) => {
        const amount = riel(c, d, t);
        // exact price × 60000, independent of fare()'s internals
        const exact =
          BigInt(Math.max(c.base * 60_000 + d * c.perKm * 60 + t * c.perMin * 1000, c.minimumFare * 60_000)) +
          BigInt(c.bookingFee * 60_000);
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
  ])('refuses %p / %p', (numerator, denominator) => {
    expect(() => ceilToRiel(numerator, denominator)).toThrow(RangeError);
  });
});
