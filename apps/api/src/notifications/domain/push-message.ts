import { OFFER_UPDATED_EVENT, offerSchema, type PushData, RIDE_UPDATED_EVENT, rideSchema } from '@lern/contracts';

// expiresAt: when this stops being worth delivering (an offer nobody can accept any more)
export type PushMessage = { title: string; body: string; tag: string; data: PushData; expiresAt?: string };
export type Push = { recipients: string[]; message: PushMessage };
type Event = { topic: string; recipients: string[]; payload: unknown };

// Which outbox events also go out as a push (PLAN.md M5). Text stays generic and data holds ids only: the phone
// fetches the snapshot itself, so nothing about the trip passes through Google. A tag makes a repeat replace the
// earlier notification instead of stacking. Never throws: a throw here would block the outbox head.
export function pushFor({ topic, recipients, payload }: Event): Push | null {
  if (topic === OFFER_UPDATED_EVENT) {
    const offer = offerSchema.safeParse(payload);
    if (!offer.success || offer.data.status !== 'pending') return null;
    const { id: offerId, rideId, expiresAt } = offer.data;
    return {
      recipients,
      message: {
        title: 'New ride offer',
        body: 'Open the app to respond.',
        tag: `offer:${offerId}`,
        data: { type: 'offer', rideId, offerId },
        expiresAt,
      },
    };
  }
  if (topic !== RIDE_UPDATED_EVENT) return null;
  const ride = rideSchema.safeParse(payload);
  if (!ride.success) return null;
  const about = { tag: `ride:${ride.data.id}`, data: { type: 'ride', rideId: ride.data.id, seq: String(ride.data.version) } as const };
  if (ride.data.status === 'cancelled') {
    return { recipients, message: { title: 'Ride cancelled', body: 'Open the app for details.', ...about } };
  }
  if (ride.data.status === 'driver_arrived') {
    // The ride outbox writes recipients as [rider, driver]
    return { recipients: recipients.slice(0, 1), message: { title: 'Your driver has arrived', body: 'Head to your pickup point.', ...about } };
  }
  return null;
}
