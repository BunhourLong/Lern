import { fare } from './fare';

describe('fare (placeholder rates, KHR)', () => {
  it('charges the base fare for a zero-length trip', () => {
    expect(fare('moto', 0)).toEqual({ amountMinor: 2000, currency: 'KHR' });
  });

  it('adds the per-km rate and rounds up to the next 100 riel', () => {
    expect(fare('moto', 1000).amountMinor).toBe(3000);
    expect(fare('moto', 1001).amountMinor).toBe(3100);
    expect(fare('remork', 2500).amountMinor).toBe(7800); // 4000 + 3750
    expect(fare('bajaj', 10_000).amountMinor).toBe(16_000); // 3000 + 13000
  });

  it('prices moto < bajaj < remork for the same trip', () => {
    const [moto, bajaj, remork] = (['moto', 'bajaj', 'remork'] as const).map((v) => fare(v, 5_000).amountMinor);
    expect(moto).toBeLessThan(bajaj);
    expect(bajaj).toBeLessThan(remork);
  });

  it('refuses a negative or fractional distance instead of producing a fractional price', () => {
    expect(() => fare('moto', -1)).toThrow(RangeError);
    expect(() => fare('moto', 1.5)).toThrow(RangeError);
  });
});
