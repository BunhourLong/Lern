import { AppState, type AppStateStatus } from 'react-native';
import type { createLanguageStore } from '../stores/language.store';

type AppStateChanges = {
  addEventListener(
    event: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
};

export function followDeviceLanguage(
  store: Pick<ReturnType<typeof createLanguageStore>, 'getState'>,
  appState: AppStateChanges = AppState,
): () => void {
  const subscription = appState.addEventListener('change', state => {
    if (state === 'active') store.getState().refreshDevice();
  });
  return () => subscription.remove();
}
