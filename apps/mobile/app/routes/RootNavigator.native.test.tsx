import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import type { TabSelectedEvent } from 'react-native-screens';
import { createStore } from 'zustand/vanilla';
import type { NotificationTarget } from '../boot/core';
import { createAppConfigStore } from '../stores/app-config.store';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { createSecurityStore } from '../stores/security.store';
import { createSessionStore } from '../stores/session.store';
import { RootNavigator } from './RootNavigator';

jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => true,
}));

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const runtime = globalThis as typeof globalThis & { __DEV__: boolean };

afterEach(() => jest.restoreAllMocks());

function renderRiderTabs(debug: ReactNode = null) {
  const session = createSessionStore();
  const appConfig = createAppConfigStore();
  const notification = createStore<NotificationTarget | null>()(() => null);
  session
    .getState()
    .signedIn({ id: 'u-1', phone: '+85512345678', roles: ['rider'] });
  appConfig.getState().setGate({ status: 'ok' });
  return render(
    <RootNavigator
      core={{
        stores: {
          session,
          appConfig,
          notification,
          driverMode: createDriverModeStore(),
          security: createSecurityStore(),
        },
        api: { requestOtp: jest.fn() },
        signIn: jest.fn(),
        becomeDriver: jest.fn(),
        enableLock: jest.fn(),
        unlock: jest.fn(),
        interruptPinCheck: jest.fn(),
        signOut: jest.fn(),
        pinWaitMs: () => 0,
      }}
      debug={debug}
    />,
  );
}

test('passes rider titles and image icons to the native iOS tabs', async () => {
  await renderRiderTabs();

  const tabs = screen.container.queryAll(
    node => node.type === 'RNSTabsScreenIOS',
  );
  expect(tabs.map(tab => tab.props)).toMatchObject([
    {
      title: 'Home',
      iconType: 'image',
      iconImageRenderingMode: 'template',
      iconImageSource: require('../assets/icons/home.png'),
    },
    {
      title: 'Activity',
      iconType: 'image',
      iconImageRenderingMode: 'template',
      iconImageSource: require('../assets/icons/activity.png'),
    },
    {
      title: 'Account',
      iconType: 'image',
      iconImageRenderingMode: 'template',
      iconImageSource: require('../assets/icons/account.png'),
    },
  ]);
  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
});

test('opens the root Debug screen from native Home in development', async () => {
  jest.replaceProperty(runtime, '__DEV__', true);
  await renderRiderTabs(<Text accessibilityRole="header">Debug tools</Text>);

  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(screen.getByRole('header', { name: 'Debug tools' })).toBeOnTheScreen();
});

test('opens Activity when the native tabs host reports its selection', async () => {
  await renderRiderTabs();

  const [host] = screen.container.queryAll(
    node => node.type === 'RNSTabsHostIOS',
  );
  const [activity] = screen.container.queryAll(
    node => node.type === 'RNSTabsScreenIOS' && node.props.title === 'Activity',
  );
  const selection: TabSelectedEvent = {
    selectedScreenKey: activity.props.screenKey,
    provenance: 1,
    actionOrigin: 'user',
    isRepeated: false,
    hasTriggeredSpecialEffect: false,
  };

  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Activity' })).toBeNull();

  await fireEvent(host, 'tabSelected', { nativeEvent: selection });

  expect(screen.getByRole('header', { name: 'Activity' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Rider home' })).toBeNull();
});
