import { OFFER_UPDATED_EVENT, offerSchema, type PushData, type PushLocale, RIDE_UPDATED_EVENT, rideSchema } from '@lern/contracts';

// expiresAt: when this stops being worth delivering (an offer nobody can accept any more)
export type PushMessage = { title: string; body: string; tag: string; data: PushData; expiresAt?: string };
// shortcut: a job queued by a build before M5.19 has no text and fails its attempts; drain the push queue before deploying once there is a deployment (M8)
export type Push = {
  recipients: string[];
  message: Omit<PushMessage, 'title' | 'body'> & { text: Record<PushLocale, { title: string; body: string }> };
};
type Event = { topic: string; recipients: string[]; payload: unknown };

// One phone's share of a push: this language's title and body, with the ids and expiry unchanged
export function localize({ text, ...message }: Push['message'], locale: PushLocale): PushMessage {
  return { ...message, ...text[locale] };
}

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
        text: {
          en: { title: 'New ride offer', body: 'Open the app to respond.' },
          km: { title: 'មានការកក់ថ្មី', body: 'បើកកម្មវិធីដើម្បីឆ្លើយតប។' },
        },
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
    return {
      recipients,
      message: {
        text: {
          en: { title: 'Ride cancelled', body: 'Open the app for details.' },
          km: { title: 'ការធ្វើដំណើរត្រូវបានបោះបង់', body: 'បើកកម្មវិធីដើម្បីមើលព័ត៌មានលម្អិត។' },
        },
        ...about,
      },
    };
  }
  if (ride.data.status === 'driver_arrived') {
    // The ride outbox writes recipients as [rider, driver]
    return {
      recipients: recipients.slice(0, 1),
      message: {
        text: {
          en: { title: 'Your driver has arrived', body: 'Head to your pickup point.' },
          km: { title: 'អ្នកបើកបររបស់អ្នកមកដល់ហើយ', body: 'សូមទៅកាន់កន្លែងទទួល។' },
        },
        ...about,
      },
    };
  }
  return null;
}
