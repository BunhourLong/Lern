import type { Money } from '@lern/contracts';
import type { useT } from '../i18n';

export function formatDistance(
  distanceM: number,
  t: ReturnType<typeof useT>,
): string {
  if (distanceM < 1000)
    return t('driverOffer.distance.m', { distance: distanceM });
  const distance = (Math.round(distanceM / 100) / 10).toFixed(1);
  return t('driverOffer.distance.km', { distance });
}

export function formatFare(
  { amountMinor, currency }: Money,
  t: ReturnType<typeof useT>,
): string {
  const digits = String(amountMinor);
  if (currency === 'KHR') {
    return t('driverOffer.fare.khr', {
      amount: digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    });
  }
  const cents = digits.padStart(3, '0');
  return t('driverOffer.fare.usd', {
    dollars: cents.slice(0, -2),
    cents: cents.slice(-2),
  });
}
