// Surge multipliers in integer basis points: 10000 = 1.0x. No floats anywhere.
export type SurgeRule = { slopeBp: number; capBp: number; maxStepBp: number };

const ONE_X = 10_000;

function whole(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}: ${value}`);
  return value;
}

function checkRule({ slopeBp, capBp, maxStepBp }: SurgeRule): void {
  whole('slopeBp', slopeBp);
  if (whole('capBp', capBp) < ONE_X) throw new RangeError(`Invalid capBp: ${capBp}`);
  // 0 would freeze surge at its current value forever
  if (whole('maxStepBp', maxStepBp) < 1) throw new RangeError(`Invalid maxStepBp: ${maxStepBp}`);
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

// 1.0x + slope × (demand/supply − 1), floored, capped; no drivers counts as one driver
export function targetBp(rule: SurgeRule, counts: { demand: number; supply: number }): number {
  checkRule(rule);
  const demand = whole('demand', counts.demand);
  const supply = whole('supply', counts.supply);
  if (demand <= supply) return ONE_X;
  const excess = whole('slopeBp × excess', rule.slopeBp * (demand - supply));
  const per = Math.max(supply, 1);
  return Math.min(rule.capBp, ONE_X + (excess - (excess % per)) / per);
}

// A rate limit, not an EMA: at most maxStepBp toward the target per call, always within [1.0x, cap]
export function smoothBp(rule: SurgeRule, prevBp: number, target: number): number {
  checkRule(rule);
  whole('prevBp', prevBp);
  whole('target', target);
  return clamp(prevBp + clamp(target - prevBp, -rule.maxStepBp, rule.maxStepBp), ONE_X, rule.capBp);
}
