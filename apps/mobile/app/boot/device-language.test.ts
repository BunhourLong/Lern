import type { AppStateStatus } from 'react-native';
import { createLanguageStore } from '../stores/language.store';
import { followDeviceLanguage } from './device-language';

function setup() {
  const store = createLanguageStore(
    { get: () => undefined, set: jest.fn(), remove: jest.fn() },
    () => 'en-US',
  );
  const refreshDevice = jest.spyOn(store.getState(), 'refreshDevice');
  type Listener = (state: AppStateStatus) => void;
  let listener: Listener | undefined;
  const remove = jest.fn(() => {
    listener = undefined;
  });
  const appState = {
    addEventListener: jest.fn((_event: 'change', onChange: Listener) => {
      listener = onChange;
      return { remove };
    }),
  };
  const unfollow = followDeviceLanguage(store, appState);
  const emit = (state: AppStateStatus) => listener?.(state);
  return { appState, emit, refreshDevice, remove, unfollow };
}

it('refreshes the device language on an active AppState change', () => {
  const { appState, emit, refreshDevice } = setup();
  expect(appState.addEventListener).toHaveBeenCalledWith(
    'change',
    expect.any(Function),
  );
  emit('active');
  expect(refreshDevice).toHaveBeenCalledTimes(1);
});

it.each(['background', 'inactive'] as const)(
  'does not refresh the device language when AppState changes to %s',
  state => {
    const { emit, refreshDevice } = setup();
    emit(state);
    expect(refreshDevice).not.toHaveBeenCalled();
  },
);

it('removes the AppState listener on cleanup', () => {
  const { emit, refreshDevice, remove, unfollow } = setup();
  emit('active');
  expect(refreshDevice).toHaveBeenCalledTimes(1);

  unfollow();
  emit('active');

  expect(refreshDevice).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
