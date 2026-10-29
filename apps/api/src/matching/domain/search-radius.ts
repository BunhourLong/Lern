// PLAN.md §2.4: the search widens 2 → 4 → 6 km, one step every 30 s after booking
export function searchRadiusM(elapsedS: number): number {
  return Math.min(2000 * (1 + Math.floor(elapsedS / 30)), 6000);
}
