// Average moto speed in Phnom Penh traffic: the ETA guess when OSRM has none
const FALLBACK_SPEED_MPS = 5;

// PLAN.md §2.4: candidates (nearest first) by road ETA to the pickup, in whole seconds. A missing ETA (OSRM down,
// or no route for that driver) is guessed from the straight line; equal ETAs keep straight-line order.
export function rankByEta<C extends { distanceM: number }>(
  candidates: C[],
  durationsS: (number | null)[] | undefined,
): (C & { etaS: number })[] {
  return candidates
    .map((c, i) => ({ ...c, etaS: Math.round(durationsS?.[i] ?? c.distanceM / FALLBACK_SPEED_MPS) }))
    .sort((a, b) => a.etaS - b.etaS);
}
