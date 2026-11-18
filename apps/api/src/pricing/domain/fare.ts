import type { Money } from '@lern/contracts';

// Whole riel (KHR only, PLAN M6.0)
export type RateCard = { base: number; perKm: number; perMin: number; minimumFare: number; bookingFee: number };

const STEP_RIEL = 100;
const ONE_X = 10_000;
// Common denominator: metres × riel/km needs 1000, seconds × riel/min needs 60
const DEN = 60_000;

function wholeRiel(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}: ${value}`);
  return value;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// The only rounding in money paths: an exact fraction of riel, up to the next 100 riel
export function ceilToRiel(numerator: number, denominator: number): number {
  wholeRiel('numerator', numerator);
  if (wholeRiel('denominator', denominator) === 0) throw new RangeError('Invalid denominator: 0');
  const rest = numerator % (STEP_RIEL * denominator);
  return wholeRiel('amount', (numerator - rest) / denominator + (rest === 0 ? 0 : STEP_RIEL));
}

// Receipt lines in whole riel; they sum to the fare's amountMinor
export type FareBreakdown = { tripMinor: number; surgeMinor: number; bookingFeeMinor: number };

// Surge (basis points, 10000 = 1.0x) multiplies max(trip, minimum); the booking fee is never surged
export function fare(
  card: RateCard,
  trip: { distanceM: number; durationS: number },
  surgeBp: number,
): { fare: Money; breakdown: FareBreakdown } {
  const { base, perKm, perMin, minimumFare, bookingFee } = card;
  const { distanceM, durationS } = trip;
  // Validate exactly the values priced below (a spread would let an extra trip key mask a card field)
  const used = { base, perKm, perMin, minimumFare, bookingFee, distanceM, durationS, surgeBp };
  for (const [name, value] of Object.entries(used)) wholeRiel(name, value);
  if (surgeBp < ONE_X) throw new RangeError(`Invalid surgeBp: ${surgeBp}`);
  // A fee in whole steps keeps ceil(trip + fee) = ceil(trip) + fee: lines sum, and 1.0x prices match pre-surge ones
  if (bookingFee % STEP_RIEL !== 0) throw new RangeError(`Invalid bookingFee: ${bookingFee}`);
  const tripUnits = Math.max(base * DEN + distanceM * perKm * (DEN / 1000) + durationS * perMin * (DEN / 60), minimumFare * DEN);
  // Every term is >= 0, so ceilToRiel's safe-integer check on the numerator proves every term was exact
  const tripMinor = ceilToRiel(tripUnits, DEN);
  // bp / 10000 in lowest terms, so 1.0x keeps the pre-surge safe range (and 1.5x needs only × 3 / 2).
  // shortcut: refuses (RangeError) once trip × 60000 × bp/g passes 2^53, i.e. a trip near 15 000 000 riel × g/bp
  // (~15 000 000 at 1.0x, ~7 500 000 at 1.5002x), far above any city fare; move the rounding to BigInt if a card nears it.
  const g = gcd(surgeBp, ONE_X);
  const surged = ceilToRiel(tripUnits * (surgeBp / g), DEN * (ONE_X / g));
  return {
    fare: { amountMinor: wholeRiel('amount', surged + bookingFee), currency: 'KHR' },
    breakdown: { tripMinor, surgeMinor: surged - tripMinor, bookingFeeMinor: bookingFee },
  };
}
