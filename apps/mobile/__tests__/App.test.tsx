/**
 * @format
 */

import { render, screen } from '@testing-library/react-native';
import App from '../App';
import { startApp } from '../app/boot/app-core';

jest.mock('../app/boot/app-core', () => {
  const { createLanguageStore } = jest.requireActual<
    typeof import('../app/stores/language.store')
  >('../app/stores/language.store');
  const language = createLanguageStore(
    { get: () => undefined, set: jest.fn(), remove: jest.fn() },
    () => 'km-KH',
  );
  return { core: { stores: { language } }, startApp: jest.fn() };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../app/screens/Debug/DebugContainer', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const { useT } =
    jest.requireActual<typeof import('../app/i18n')>('../app/i18n');
  return function DebugContainer() {
    const t = useT();
    return <Text>{t('common.retry')}</Text>;
  };
});

test('renders in the device language and starts the app once', async () => {
  await render(<App />);
  expect(screen.getByText('ព្យាយាមម្តងទៀត')).toBeOnTheScreen();
  expect(startApp).toHaveBeenCalledTimes(1);
});
