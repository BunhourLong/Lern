// Display only, never money maths. Integer steps: cents rounded half-up, then grouped; Intl is not relied on in Hermes
export function approxUsd(riel: number, khrPerUsd: number): string {
  const cents = Math.floor((riel * 200 + khrPerUsd) / (2 * khrPerUsd));
  const dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `≈ $${dollars}.${String(cents % 100).padStart(2, '0')}`;
}
