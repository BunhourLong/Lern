import type { Money, VehicleType } from '@lern/contracts';

// shortcut: hard-coded placeholder rates in riel; versioned rate_cards with minimum fare and booking fee land in M6
const RATES: Record<VehicleType, { base: number; perKm: number }> = {
  moto: { base: 2000, perKm: 1000 },
  bajaj: { base: 3000, perKm: 1300 },
  remork: { base: 4000, perKm: 1500 },
};

const ROUND_TO_RIEL = 100;

// Integer maths only: work in milli-riel (metres × riel/km), then round up to the next 100 riel
export function fare(vehicleType: VehicleType, distanceM: number): Money {
  if (!Number.isSafeInteger(distanceM) || distanceM < 0) throw new RangeError(`Invalid distance: ${distanceM}`);
  const { base, perKm } = RATES[vehicleType];
  const milli = base * 1000 + distanceM * perKm;
  const step = ROUND_TO_RIEL * 1000;
  const rounded = milli % step === 0 ? milli : milli + step - (milli % step);
  return { amountMinor: rounded / 1000, currency: 'KHR' };
}
