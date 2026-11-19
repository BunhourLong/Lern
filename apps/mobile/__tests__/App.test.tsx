/**
 * @format
 */

import { render, screen } from '@testing-library/react-native';
import App from '../App';
import { startApp } from '../app/boot/app-core';

jest.mock('../app/boot/app-core', () => {
  const { createAppConfigStore } = jest.requireActual<
    typeof import('../app/stores/app-config.store')
  >('../app/stores/app-config.store');
  const { createLanguageStore } = jest.requireActual<
    typeof import('../app/stores/language.store')
  >('../app/stores/language.store');
  const { createSessionStore } = jest.requireActual<
    typeof import('../app/stores/session.store')
  >('../app/stores/session.store');
  const { createStore } = jest.requireActual('zustand/vanilla');
  const language = createLanguageStore(
    { get: () => undefined, set: jest.fn(), remove: jest.fn() },
    () => 'km-KH',
  );
  return {
    core: {
      stores: {
        language,
        session: createSessionStore(),
        appConfig: createAppConfigStore(),
        notification: createStore(() => null),
      },
    },
    startApp: jest.fn(),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => false,
}));
jest.mock('../app/screens/Debug/DebugContainer', () => () => null);

test('shows the loading gate in the device language and starts the app once', async () => {
  await render(<App />);
  expect(
    screen.getByRole('progressbar', { name: 'កំពុងដំណើរការ' }),
  ).toBeOnTheScreen();
  expect(startApp).toHaveBeenCalledTimes(1);
});
