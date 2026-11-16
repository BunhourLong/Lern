import type { Money } from '@lern/contracts';

// Whole riel (KHR only, PLAN M6.0)
export type RateCard = { base: number; perKm: number; perMin: number; minimumFare: number; bookingFee: number };

const STEP_RIEL = 100;
// Common denominator: metres × riel/km needs 1000, seconds × riel/min needs 60
const DEN = 60_000;

function wholeRiel(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}: ${value}`);
  return value;
}

// The only rounding in money paths: an exact fraction of riel, up to the next 100 riel
export function ceilToRiel(numerator: number, denominator: number): number {
  wholeRiel('numerator', numerator);
  if (wholeRiel('denominator', denominator) === 0) throw new RangeError('Invalid denominator: 0');
  const rest = numerator % (STEP_RIEL * denominator);
  return wholeRiel('amount', (numerator - rest) / denominator + (rest === 0 ? 0 : STEP_RIEL));
}

export function fare(card: RateCard, trip: { distanceM: number; durationS: number }): Money {
  const { base, perKm, perMin, minimumFare, bookingFee } = card;
  const { distanceM, durationS } = trip;
  // Validate exactly the values priced below (a spread would let an extra trip key mask a card field)
  const used = { base, perKm, perMin, minimumFare, bookingFee, distanceM, durationS };
  for (const [name, value] of Object.entries(used)) wholeRiel(name, value);
  const tripUnits = base * DEN + distanceM * perKm * (DEN / 1000) + durationS * perMin * (DEN / 60);
  const units = Math.max(tripUnits, minimumFare * DEN) + bookingFee * DEN;
  // Every term is >= 0, so ceilToRiel's safe-integer check on the sum proves every term was exact
  return { amountMinor: ceilToRiel(units, DEN), currency: 'KHR' };
}
