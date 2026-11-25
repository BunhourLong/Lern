import * as crypto from 'node:crypto';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

// Pass-through spy, so a test can count scrypt runs
jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof crypto>('node:crypto');
  return { ...actual, scrypt: jest.fn(actual.scrypt) };
});

const FORMAT = /^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{86}$/;

it('hashes to scrypt$32768$8$1$<salt>$<key> with a fresh salt each time, and verifies only the right password', async () => {
  const [a, b] = await Promise.all([hashPassword('correct horse'), hashPassword('correct horse')]);
  expect(a).toMatch(FORMAT);
  expect(a).not.toBe(b);
  expect(await verifyPassword('correct horse', a)).toBe(true);
  expect(await verifyPassword('correct horsf', a)).toBe(false);
  expect(await verifyPassword('', a)).toBe(false);
});

it('returns false, without throwing, for a malformed hash or one with other parameters', async () => {
  const good = await hashPassword('pw');
  const [, , , , salt, key] = good.split('$');
  for (const bad of [
    '',
    'garbage',
    ['bcrypt', '32768', '8', '1', salt, key].join('$'),
    ['scrypt', '16384', '8', '1', salt, key].join('$'), // weaker cost than the policy
    ['scrypt', '32768', '8', '2', salt, key].join('$'),
    ['scrypt', '32768', '8', '1', salt, key.slice(0, 40)].join('$'), // short key
    ['scrypt', '32768', '8', '1', salt].join('$'),
    ['scrypt', '32768', '8', '1', salt, key, 'extra'].join('$'),
    ['scrypt', '32768', '8', '1', '', key].join('$'),
    ['scrypt', '32768', '8', '1', salt, `${key.slice(0, -1)}!`].join('$'), // not base64url
  ]) {
    jest.mocked(crypto.scrypt).mockClear();
    await expect(verifyPassword('pw', bad)).resolves.toBe(false);
    expect(crypto.scrypt).toHaveBeenCalledTimes(1); // a bad row costs the same scrypt work: timing tells nothing
  }
});

it('ships a well-formed dummy hash that burns the same scrypt work and matches nothing', async () => {
  expect(DUMMY_PASSWORD_HASH).toMatch(FORMAT);
  expect(await verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
  expect(await verifyPassword('password', DUMMY_PASSWORD_HASH)).toBe(false);
});
