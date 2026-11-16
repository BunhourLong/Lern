import { Logger } from '@nestjs/common';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { PushMessage } from './domain/push-message';
import { PushProvider, type PushResult, type PushWindow } from './push.provider';

// invalid-argument: what FCM v1 answers a malformed token with. Our own message is fixed text and ids, so the token
// is the only thing that varies; a client can register anything.
const GONE = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);
const TRANSIENT = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unknown-error',
  'messaging/message-rate-exceeded',
  // sendEach reports a network failure per message, under the app's code
  'app/network-error',
  'app/network-timeout',
]);

// A missing or unreadable key file throws here, so a bad deploy fails at boot, not at the first offer
export const fcmMessaging = (serviceAccountPath: string): Messaging =>
  getMessaging(initializeApp({ credential: cert(serviceAccountPath) }));

// Notification + data, not data-only: the OS draws it, even for a closed app (iOS doesn't deliver silent pushes to a
// swiped-away app, and data-only shows nothing on its own). iOS delivery needs an APNs key in Firebase; see PLAN.md.
export class FcmPushProvider extends PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);

  constructor(private readonly messaging: Messaging) {
    super();
  }

  async send(tokens: string[], { title, body, tag, data }: PushMessage, { nowMs, ttlMs }: PushWindow): Promise<PushResult> {
    const expiration = String(Math.floor((nowMs + ttlMs) / 1000));
    let responses;
    try {
      ({ responses } = await this.messaging.sendEach(
        tokens.map((token) => ({
          token,
          notification: { title, body },
          data,
          android: { priority: 'high', ttl: ttlMs, notification: { tag } },
          apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert', 'apns-collapse-id': tag, 'apns-expiration': expiration } },
        })),
      ));
    } catch (err) {
      this.logger.warn(`FCM send failed: ${(err as Error).message}`);
      return { invalid: [], retry: true };
    }
    const invalid: string[] = [];
    let retry = false;
    responses.forEach(({ success, error }, i) => {
      if (success) return;
      if (error && GONE.has(error.code)) {
        invalid.push(tokens[i]);
        // Also what a message our own code broke would get: this line is how a bad deploy that deletes tokens shows
        if (error.code === 'messaging/invalid-argument') this.logger.warn(`FCM rejected a token: ${error.message}`);
        return;
      }
      if (error && TRANSIENT.has(error.code)) retry = true;
      this.logger.warn(`FCM refused a message: ${error?.code}`);
    });
    return { invalid, retry };
  }
}
