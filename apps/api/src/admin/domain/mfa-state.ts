import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

// The OAuth state sent through Duo and back: which pending login it is for, whose, and until when, signed so a
// forged or expired one is refused before Redis or Duo is asked. Format: base64url(v1|pendingId|staffUserId|exp).hmac
export type MfaState = { pendingId: string; staffUserId: string; expSec: number };

const B64URL = /^[A-Za-z0-9_-]+$/;

// Its own key, derived from JWT_SECRET, so a state can never pass as a JWT or the reverse
export const deriveMfaStateKey = (jwtSecret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', jwtSecret, '', 'lern:staff-mfa-state:v1', 32));

const mac = (payload: string, key: Buffer) => createHmac('sha256', key).update(payload).digest('base64url');

export function signMfaState({ pendingId, staffUserId, expSec }: MfaState, key: Buffer): string {
  const payload = Buffer.from(`v1|${pendingId}|${staffUserId}|${expSec}`).toString('base64url');
  return `${payload}.${mac(payload, key)}`;
}

// null for anything forged, malformed or expired (exp must be after nowSec); never throws
export function verifyMfaState(state: string, key: Buffer, nowSec: number): MfaState | null {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts.every((part) => B64URL.test(part))) return null;
  const [payload, sig] = parts;
  const given = Buffer.from(sig);
  const expected = Buffer.from(mac(payload, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  // One encoding per payload: spare low bits in the last character would decode to the same bytes
  const decoded = Buffer.from(payload, 'base64url');
  if (decoded.toString('base64url') !== payload) return null;
  const fields = decoded.toString('utf8').split('|');
  if (fields.length !== 4) return null;
  const [version, pendingId, staffUserId, exp] = fields;
  if (version !== 'v1' || !pendingId || !staffUserId || !/^\d+$/.test(exp)) return null;
  const expSec = Number(exp);
  return Number.isSafeInteger(expSec) && expSec > nowSec ? { pendingId, staffUserId, expSec } : null;
}
