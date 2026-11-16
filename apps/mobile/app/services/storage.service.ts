import * as Keychain from 'react-native-keychain';
import { createMMKV } from 'react-native-mmkv';

// Synchronous persistent strings for non-secrets (offline queue). Services take this interface, so tests pass a Map.
export type KeyValueStore = {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

// One secret (the refresh token): iOS Keychain / Android Keystore, never MMKV (readable from backups and rooted phones)
export type SecretStore = {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
};

export function mmkvStore(id: string): KeyValueStore {
  const mmkv = createMMKV({ id });
  return {
    get: key => mmkv.getString(key),
    set: (key, value) => mmkv.set(key, value),
    remove: key => {
      mmkv.remove(key);
    },
  };
}

export function keychainSecret(service: string): SecretStore {
  const options = {
    service,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
  return {
    get: async () => {
      const found = await Keychain.getGenericPassword({ service });
      return found ? found.password : undefined;
    },
    set: async value => {
      await Keychain.setGenericPassword('session', value, options);
    },
    clear: async () => {
      await Keychain.resetGenericPassword({ service });
    },
  };
}
