import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

// Staff password hashing: scrypt from node:crypto (no dependency). N=2^15, r=8 needs 128·N·r = 32 MiB, which Node's
// 32 MiB default maxmem refuses, so maxmem is explicit. Always the async form: scryptSync would block the event loop.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const OPTIONS: ScryptOptions = { N, r: R, p: P, maxmem: 64 * 1024 * 1024 };
// Only hashes made with today's policy verify; 22 and 86 base64url chars are 16 and 64 bytes
const FORMAT = /^scrypt\$32768\$8\$1\$([\w-]{22})\$([\w-]{86})$/;

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, OPTIONS, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// False, never a throw, for a hash this policy didn't make: a bad row must read as a wrong password
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const m = FORMAT.exec(storedHash);
  if (!m) {
    await derive(password, DUMMY_SALT); // same scrypt work as a real check: a bad row isn't faster
    return false;
  }
  const expected = Buffer.from(m[2], 'base64url');
  const actual = await derive(password, Buffer.from(m[1], 'base64url'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Hash of a random password nobody kept: unknown, disabled and locked accounts verify against it, so they cost
// the same scrypt work as a real wrong password and timing doesn't tell them apart
export const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$iGkAWHth1nz1g3bNktnhvA$IMwY32vGZGuHHqUGm9F6HzZVfJMOSjhZ75J-bitIsr4HEmhQ7c0Lf5Ty_Q2WEnauEHUEyeclay5y-b1RT_TY0g';
const DUMMY_SALT = Buffer.from(DUMMY_PASSWORD_HASH.split('$')[4], 'base64url');
