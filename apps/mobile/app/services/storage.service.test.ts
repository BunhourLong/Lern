import * as Keychain from 'react-native-keychain';
import { keychainSecret, mmkvStore } from './storage.service';

// Importing react-native-mmkv loads Nitro's native module, absent in Jest; the adapter is all this test checks
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const values = new Map<string, string>();
    return {
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
      remove: (key: string) => values.delete(key),
    };
  },
}));

jest.mock('react-native-keychain', () => {
  const saved = new Map<string, string>();
  return {
    ACCESSIBLE: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
        'AccessibleAfterFirstUnlockThisDeviceOnly',
    },
    setGenericPassword: jest.fn(
      async (
        _user: string,
        password: string,
        { service }: { service: string },
      ) => {
        saved.set(service, password);
        return { service, storage: 'test' };
      },
    ),
    getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
      saved.has(service)
        ? { service, username: 'session', password: saved.get(service) }
        : false,
    ),
    resetGenericPassword: jest.fn(async ({ service }: { service: string }) =>
      saved.delete(service),
    ),
  };
});

it('keeps strings in MMKV under their key until removed', () => {
  const store = mmkvStore('test');
  expect(store.get('k')).toBeUndefined();
  store.set('k', 'v');
  expect(store.get('k')).toBe('v');
  store.remove('k');
  expect(store.get('k')).toBeUndefined();
});

it('keeps one secret in the Keychain under its own service, and forgets it on clear', async () => {
  const secret = keychainSecret('lern.refresh');
  expect(await secret.get()).toBeUndefined();
  await secret.set('t0k3n');
  expect(await secret.get()).toBe('t0k3n');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'session',
    't0k3n',
    expect.objectContaining({ service: 'lern.refresh' }),
  );
  await secret.clear();
  expect(await secret.get()).toBeUndefined();
});
