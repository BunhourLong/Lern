import fc from 'fast-check';
import { smoothBp, targetBp, type SurgeRule } from './surge';

const R: SurgeRule = { slopeBp: 5000, capBp: 20000, maxStepBp: 2500 };
const UNSAFE = 2 ** 53;
const target = (rule: SurgeRule, demand: number, supply: number) => targetBp(rule, { demand, supply });

// Every field valid for a rule; bad values for each, shared by both functions
const badRules: [string, SurgeRule][] = [
  ['negative slopeBp', { ...R, slopeBp: -1 }],
  ['fractional slopeBp', { ...R, slopeBp: 0.5 }],
  ['unsafe slopeBp', { ...R, slopeBp: UNSAFE }],
  ['capBp below 1.0x', { ...R, capBp: 9999 }],
  ['fractional capBp', { ...R, capBp: 15000.5 }],
  ['unsafe capBp', { ...R, capBp: UNSAFE }],
  ['maxStepBp 0 (surge would never move)', { ...R, maxStepBp: 0 }],
  ['negative maxStepBp', { ...R, maxStepBp: -1 }],
  ['fractional maxStepBp', { ...R, maxStepBp: 1.5 }],
  ['unsafe maxStepBp', { ...R, maxStepBp: UNSAFE }],
];
const badCounts = [-1, 1.5, UNSAFE, NaN];

describe('targetBp (demand/supply to a multiplier, 10000 = 1.0x)', () => {
  it.each([
    [0, 0, 10000],
    [5, 5, 10000],
    [3, 5, 10000],
    [2, 1, 15000],
    [3, 2, 12500],
    [1, 0, 15000], // no drivers counts as one: no jump to the cap
    [4, 1, 20000], // 25000 capped
    [7, 3, 16666], // 16666.67 floored: the rider gets the fraction
  ])('demand %p, supply %p -> %p', (demand, supply, bp) => {
    expect(target(R, demand, supply)).toBe(bp);
  });

  it.each(badRules)('refuses a rule with %s', (_name, rule) => {
    expect(() => target(rule, 2, 1)).toThrow(RangeError);
  });

  it.each(badCounts)('refuses demand %p and supply %p', (bad) => {
    expect(() => target(R, bad, 1)).toThrow(RangeError);
    expect(() => target(R, 1, bad)).toThrow(RangeError);
  });

  it('refuses a slope x excess past the safe range instead of a wrong multiplier', () => {
    expect(() => target({ ...R, slopeBp: Number.MAX_SAFE_INTEGER }, 3, 1)).toThrow(RangeError);
  });
});

describe('smoothBp (rate limit toward the target)', () => {
  it.each([
    [10000, 20000, 12500],
    [20000, 10000, 17500],
    [12000, 12500, 12500], // within one step: lands exactly
    [30000, 20000, 20000], // cap lowered since the last minute: down to it at once
    [9000, 10000, 10000],
  ])('prev %p, target %p -> %p', (prev, to, bp) => {
    expect(smoothBp(R, prev, to)).toBe(bp);
  });

  it.each(badRules)('refuses a rule with %s', (_name, rule) => {
    expect(() => smoothBp(rule, 10000, 20000)).toThrow(RangeError);
  });

  it.each(badCounts)('refuses prev %p and target %p', (bad) => {
    expect(() => smoothBp(R, bad, 10000)).toThrow(RangeError);
    expect(() => smoothBp(R, 10000, bad)).toThrow(RangeError);
  });
});

describe('surge properties', () => {
  // maxStepBp stays below the cap's range, or every smooth is one jump and the step bound proves nothing
  const rule = fc.integer({ min: 10_002, max: 100_000 }).chain((capBp) =>
    fc.record({
      slopeBp: fc.integer({ min: 0, max: 100_000 }),
      capBp: fc.constant(capBp),
      maxStepBp: fc.integer({ min: 1, max: capBp - 10_001 }),
    }),
  );
  const n = fc.integer({ min: 0, max: 1_000_000 });
  // a rule with prev and target both in [1.0x, cap]
  const ruleAndBps = rule.chain((r) =>
    fc.tuple(fc.constant(r), fc.integer({ min: 10_000, max: r.capBp }), fc.integer({ min: 10_000, max: r.capBp })),
  );

  it('target is a whole number in [1.0x, cap], and 1.0x whenever demand <= supply', () => {
    fc.assert(
      fc.property(rule, n, n, (r, demand, supply) => {
        const bp = target(r, demand, supply);
        expect(Number.isSafeInteger(bp) && bp >= 10_000 && bp <= r.capBp).toBe(true);
        if (demand <= supply) expect(bp).toBe(10_000);
      }),
    );
  });

  it('target never falls as demand grows or rises as supply grows', () => {
    fc.assert(
      fc.property(rule, n, n, n, (r, a, b, other) => {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        expect(target(r, lo, other)).toBeLessThanOrEqual(target(r, hi, other));
        expect(target(r, other, lo)).toBeGreaterThanOrEqual(target(r, other, hi));
      }),
    );
  });

  it('smooth stays in [1.0x, cap] from any previous value', () => {
    fc.assert(
      fc.property(rule, n, n, (r, prev, to) => {
        const bp = smoothBp(r, prev, to);
        expect(Number.isSafeInteger(bp) && bp >= 10_000 && bp <= r.capBp).toBe(true);
      }),
    );
  });

  it('smooth moves toward the target by at most maxStepBp', () => {
    fc.assert(
      fc.property(ruleAndBps, ([r, prev, to]) => {
        const bp = smoothBp(r, prev, to);
        expect(bp).toBeGreaterThanOrEqual(Math.min(prev, to));
        expect(bp).toBeLessThanOrEqual(Math.max(prev, to));
        expect(Math.abs(bp - prev)).toBeLessThanOrEqual(r.maxStepBp);
      }),
    );
  });

  it('smooth reaches the target in exactly ceil(|target - prev| / maxStepBp) steps, then stays', () => {
    fc.assert(
      fc.property(ruleAndBps, ([r, prev, to]) => {
        const steps = Math.ceil(Math.abs(to - prev) / r.maxStepBp);
        let bp = prev;
        for (let i = 0; i < steps; i++) {
          expect(bp).not.toBe(to);
          bp = smoothBp(r, bp, to);
        }
        expect(bp).toBe(to);
        expect(smoothBp(r, bp, to)).toBe(to);
      }),
    );
  });
});
