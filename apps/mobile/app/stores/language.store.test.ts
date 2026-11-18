import type { KeyValueStore } from '../services/storage.service';
import { createLanguageStore } from './language.store';

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: key => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: key => {
      values.delete(key);
    },
  };
}

it('follows the device language without an override', () => {
  const store = createLanguageStore(memoryStore(), () => 'km-KH');
  expect(store.getState()).toMatchObject({ language: 'km', override: null });
});

it('sets the language and persists the override', () => {
  const kv = memoryStore();
  const store = createLanguageStore(kv, () => 'en-US');
  store.getState().setOverride('km');
  expect(store.getState()).toMatchObject({ language: 'km', override: 'km' });
  expect(kv.get('language')).toBe('km');
});

it('restores the override when a new store starts', () => {
  const kv = memoryStore();
  createLanguageStore(kv, () => 'en-US')
    .getState()
    .setOverride('km');
  const restarted = createLanguageStore(kv, () => 'en-US');
  expect(restarted.getState()).toMatchObject({
    language: 'km',
    override: 'km',
  });
});

it('removes a cleared override and follows the device again', () => {
  const kv = memoryStore();
  kv.set('language', 'en');
  const store = createLanguageStore(kv, () => 'km-KH');
  store.getState().setOverride(null);
  expect(kv.get('language')).toBeUndefined();
  expect(store.getState()).toMatchObject({ language: 'km', override: null });
});

it.each(['fr', ''])('ignores an invalid stored override %p', value => {
  const kv = memoryStore();
  kv.set('language', value);
  const store = createLanguageStore(kv, () => 'km-KH');
  expect(store.getState()).toMatchObject({ language: 'km', override: null });
});

it('refreshes the device language when the device tag changes', () => {
  const deviceTag = jest.fn(() => 'en-US');
  const store = createLanguageStore(memoryStore(), deviceTag);
  deviceTag.mockReturnValue('km-KH');
  store.getState().refreshDevice();
  expect(store.getState()).toMatchObject({ language: 'km', override: null });
});

it('keeps the override when the device tag changes', () => {
  const deviceTag = jest.fn(() => 'km-KH');
  const kv = memoryStore();
  kv.set('language', 'km');
  const store = createLanguageStore(kv, deviceTag);
  deviceTag.mockClear().mockReturnValue('en-US');
  store.getState().refreshDevice();
  expect(deviceTag).toHaveBeenCalledTimes(1);
  expect(store.getState()).toMatchObject({ language: 'km', override: 'km' });
  expect(kv.get('language')).toBe('km');
});
