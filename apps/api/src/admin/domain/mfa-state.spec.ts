import { createHmac } from 'node:crypto';
import { deriveMfaStateKey, signMfaState, verifyMfaState } from './mfa-state';

const key = deriveMfaStateKey('a-test-secret-that-is-32-chars-long');
const claims = { pendingId: 'p'.repeat(22), staffUserId: '6f1c2a5e-8d1b-4c1e-9a43-2b1f7c9d0e11', expSec: 1_000_300 };
const NOW = 1_000_000;
const b64 = (s: string) => Buffer.from(s).toString('base64url');

it('derives a 32-byte key that differs from the JWT secret and per secret', () => {
  expect(key).toHaveLength(32);
  expect(key.equals(Buffer.from('a-test-secret-that-is-32-chars-long').subarray(0, 32))).toBe(false);
  expect(key.equals(deriveMfaStateKey('another-secret-that-is-32-chars-x'))).toBe(false);
});

it('round-trips a URL-safe state within Duo’s 22–1024 length', () => {
  const state = signMfaState(claims, key);
  expect(state).toMatch(/^[\w-]+\.[\w-]{43}$/);
  expect(state.length).toBeGreaterThanOrEqual(22);
  expect(state.length).toBeLessThanOrEqual(1024);
  expect(verifyMfaState(state, key, NOW)).toEqual(claims);
});

it('rejects a tampered payload, a tampered signature and another key', () => {
  const [payload, sig] = signMfaState(claims, key).split('.');
  const forged = b64(`v1|${claims.pendingId}|00000000-0000-0000-0000-000000000000|${claims.expSec}`);
  expect(verifyMfaState(`${forged}.${sig}`, key, NOW)).toBeNull();
  expect(verifyMfaState(`${payload}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, key, NOW)).toBeNull();
  expect(verifyMfaState(signMfaState(claims, deriveMfaStateKey('another-secret-that-is-32-chars-x')), key, NOW)).toBeNull();
});

it('rejects a state at or after its expiry (server clock)', () => {
  const state = signMfaState(claims, key);
  expect(verifyMfaState(state, key, claims.expSec - 1)).toEqual(claims);
  expect(verifyMfaState(state, key, claims.expSec)).toBeNull();
  expect(verifyMfaState(state, key, claims.expSec + 1)).toBeNull();
});

it('returns null, never throws, on malformed input', () => {
  const state = signMfaState(claims, key);
  const [payload, sig] = state.split('.');
  for (const bad of ['', '.', 'abc', `${state}.x`, `${state}=`, `${payload}.`, `.${sig}`, state.replace('.', '+'), 'a b.c', '\u0000.\u0000']) {
    expect(verifyMfaState(bad, key, NOW)).toBeNull();
  }
});

it('rejects a correctly signed payload in the wrong format', () => {
  const { pendingId, staffUserId, expSec } = claims;
  for (const fields of [
    `v2|${pendingId}|${staffUserId}|${expSec}`,
    `v1||${staffUserId}|${expSec}`,
    `v1|${pendingId}||${expSec}`,
    `v1|${pendingId}|${staffUserId}|`,
    `v1|${pendingId}|${staffUserId}|1e9`,
    `v1|${pendingId}|${staffUserId}|-5`,
    `v1|${pendingId}|${staffUserId}|${expSec}|extra`,
  ]) {
    const payload = b64(fields);
    expect(verifyMfaState(`${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`, key, NOW)).toBeNull();
  }
});

const resign = (payload: string) => `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;

it('rejects a non-canonical payload encoding even when it is correctly signed', () => {
  const [payload] = signMfaState(claims, key).split('.');
  // The payload's byte length leaves unused low bits in the last character: setting one decodes to the same bytes
  expect(Buffer.from(payload, 'base64url').length % 3).not.toBe(0);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const variant = payload.slice(0, -1) + alphabet[alphabet.indexOf(payload.at(-1)!) | 1];
  expect(variant).not.toBe(payload);
  expect(Buffer.from(variant, 'base64url').equals(Buffer.from(payload, 'base64url'))).toBe(true);
  expect(verifyMfaState(resign(variant), key, NOW)).toBeNull();
});

it('rejects an expiry too large to be a safe integer (it would read as Infinity)', () => {
  const huge = b64(`v1|${claims.pendingId}|${claims.staffUserId}|${'9'.repeat(400)}`);
  expect(verifyMfaState(resign(huge), key, NOW)).toBeNull();
});
