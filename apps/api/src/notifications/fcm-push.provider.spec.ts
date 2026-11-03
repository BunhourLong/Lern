import { Logger } from '@nestjs/common';
import type { Messaging } from 'firebase-admin/messaging';
import { FcmPushProvider } from './fcm-push.provider';
import type { PushMessage } from './domain/push-message';

const message: PushMessage = {
  title: 'Ride cancelled',
  body: 'Open the app for details.',
  tag: 'ride:abc',
  data: { type: 'ride', rideId: 'abc', seq: '3' },
};
const failed = (code: string) => ({ success: false, error: { code, message: 'x' } });
const ok = { success: true, messageId: 'm' };
const provider = (responses: object[]) => {
  const sendEach = jest.fn().mockResolvedValue({ responses });
  return { sendEach, push: new FcmPushProvider({ sendEach } as unknown as Messaging) };
};

it('sends one high-priority, expiring, collapsible notification per token', async () => {
  const { sendEach, push } = provider([ok, ok]);
  await expect(push.send(['t1', 't2'], message, { nowMs: 1_000_000, ttlMs: 15_000 })).resolves.toEqual({ invalid: [], retry: false });
  const [first, second] = (sendEach.mock.calls[0] as [{ token: string }[]])[0];
  expect(first).toEqual({
    token: 't1',
    notification: { title: 'Ride cancelled', body: 'Open the app for details.' },
    data: { type: 'ride', rideId: 'abc', seq: '3' },
    android: { priority: 'high', ttl: 15_000, notification: { tag: 'ride:abc' } },
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert', 'apns-collapse-id': 'ride:abc', 'apns-expiration': '1015' },
    },
  });
  expect(second.token).toBe('t2');
});

// invalid-argument is what FCM v1 answers a malformed token with, and the token is the only client-controlled field
it.each(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'])(
  'reports a token FCM answers %s to as invalid, without a retry',
  async (code) => {
    const { push } = provider([ok, failed(code)]);
    await expect(push.send(['t1', 't2'], message, { nowMs: 0, ttlMs: 1000 })).resolves.toEqual({ invalid: ['t2'], retry: false });
  },
);

// A network failure arrives per message, not as a rejected call: sendEach reports each settled promise
it.each([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unknown-error',
  'messaging/message-rate-exceeded',
  'app/network-error',
  'app/network-timeout',
])(
  'asks for a retry on %s, which may pass, and keeps the token',
  async (code) => {
    const { push } = provider([failed(code)]);
    await expect(push.send(['t1'], message, { nowMs: 0, ttlMs: 1000 })).resolves.toEqual({ invalid: [], retry: true });
  },
);

// Our configuration, not the phone: a retry can't fix it (it would only re-alert the other tokens in the job), and a
// wrong key must not wipe every user's token
it.each(['messaging/mismatched-credential', 'messaging/third-party-auth-error'])(
  'neither retries nor forgets the token on %s',
  async (code) => {
    const { push } = provider([failed(code)]);
    await expect(push.send(['t1'], message, { nowMs: 0, ttlMs: 1000 })).resolves.toEqual({ invalid: [], retry: false });
  },
);

// The same answer would come for a message our own code broke: the log is how a bad deploy gets noticed
it('says why when it forgets a token over invalid-argument', async () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const { push } = provider([{ success: false, error: { code: 'messaging/invalid-argument', message: 'bad field x' } }]);
  await push.send(['secret-token'], message, { nowMs: 0, ttlMs: 1000 });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad field x'));
  expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
  warn.mockRestore();
});

it('asks for a retry when the whole call fails', async () => {
  const sendEach = jest.fn().mockRejectedValue(new Error('network'));
  const push = new FcmPushProvider({ sendEach } as unknown as Messaging);
  await expect(push.send(['t1'], message, { nowMs: 0, ttlMs: 1000 })).resolves.toEqual({ invalid: [], retry: true });
});
