import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  getRandomBytes,
} from 'expo-crypto';
import type { PinHasher } from './pin-lock.service';

// expo-crypto: a secure random salt (Math.random is predictable) and a native SHA-256; Hermes has no WebCrypto
export const expoPinHasher: PinHasher = {
  salt: () =>
    Array.from(getRandomBytes(16), b => b.toString(16).padStart(2, '0')).join(
      '',
    ),
  hash: (salt, pin) =>
    digestStringAsync(CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`),
};
