import { digestStringAsync } from 'expo-crypto';
import { expoPinHasher } from './pin-hasher.service';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: jest.fn((n: number) =>
    Uint8Array.from({ length: n }, (_, i) => i * 17),
  ),
  digestStringAsync: jest.fn(async () => 'digest'),
}));

it('makes a 16-byte salt as hex, from the secure random source', () => {
  expect(expoPinHasher.salt()).toBe('00112233445566778899aabbccddeeff');
});

it('hashes salt and PIN with SHA-256', async () => {
  expect(await expoPinHasher.hash('abc', '123456')).toBe('digest');
  expect(digestStringAsync).toHaveBeenCalledWith('SHA-256', 'abc:123456');
});
