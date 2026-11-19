import type { Me } from '@lern/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createContext, useContext } from 'react';
import { Linking, StyleSheet, Text, useColorScheme } from 'react-native';
import { themes } from '@theme';
import { createAppConfigStore } from '../stores/app-config.store';
import { createSessionStore } from '../stores/session.store';
import { RootNavigator } from './RootNavigator';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => false,
}));

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const storeUrl = 'https://example.com/lern';
const me = (...roles: Me['roles']): Me => ({
  id: 'u-1',
  phone: '+85512345678',
  roles,
});
const mockColorScheme = jest.mocked(useColorScheme);

beforeEach(() => {
  mockColorScheme.mockReturnValue('light');
});

afterEach(() => jest.restoreAllMocks());

function setup() {
  const session = createSessionStore();
  const appConfig = createAppConfigStore();
  const requestOtp = jest
    .fn<Promise<undefined>, [string]>()
    .mockResolvedValue(undefined);
  const signIn = jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined);
  const core = { stores: { session, appConfig }, api: { requestOtp }, signIn };
  const navigator = (
    <RootNavigator
      core={core}
      debug={<Text accessibilityRole="header">Debug tools</Text>}
    />
  );
  return { session, appConfig, navigator, requestOtp, signIn };
}

test('loads until both stores are ready', async () => {
  const { session, appConfig, navigator } = setup();
  await render(navigator);
  expect(
    screen.getByRole('progressbar', { name: 'Loading' }),
  ).toBeOnTheScreen();

  await act(() => appConfig.getState().setGate({ status: 'ok' }));
  expect(
    screen.getByRole('progressbar', { name: 'Loading' }),
  ).toBeOnTheScreen();

  await act(() => session.getState().signedOut());
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled();
});

test('switches between login, rider and driver as the session changes', async () => {
  const { session, appConfig, navigator } = setup();
  appConfig.getState().setGate({ status: 'ok' });
  session.getState().signedOut();
  await render(navigator);
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();

  await act(() => session.getState().signedIn(me('rider')));
  expect(screen.queryByLabelText('Phone number')).toBeNull();
  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();

  await act(() => session.getState().signedIn(me('rider', 'driver')));
  expect(screen.queryByRole('header', { name: 'Rider home' })).toBeNull();
  expect(screen.getByRole('header', { name: 'Driver home' })).toBeOnTheScreen();

  await act(() => session.getState().signedOut());
  expect(screen.queryByRole('header', { name: 'Driver home' })).toBeNull();
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
});

test.each([
  ['rider', 'Rider home'],
  ['driver', 'Driver home'],
] as const)(
  'replaces both sign-in screens with %s home after verification',
  async (role, title) => {
    const { session, appConfig, navigator, requestOtp, signIn } = setup();
    appConfig.getState().setGate({ status: 'ok' });
    session.getState().signedOut();
    signIn.mockImplementationOnce(async () => {
      session.getState().signedIn(me(role));
    });
    await render(navigator);

    await fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      '012 345 678',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(requestOtp).toHaveBeenCalledWith('+85512345678');
    expect(
      screen.getByText('Enter the code sent to +85512345678.'),
    ).toBeOnTheScreen();
    expect(
      screen.container
        .queryAll(node => node.type === 'RNSScreenStackHeaderConfig')
        .map(header => header.props),
    ).toContainEqual(
      expect.objectContaining({
        title: 'Verification code',
        backTitle: 'Back',
      }),
    );
    expect(
      screen.getByRole('button', { name: /^Resend in \d+s$/ }),
    ).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    expect(signIn).toHaveBeenCalledWith('+85512345678', '123456');
    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Phone number', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.queryByLabelText('Code', { includeHiddenElements: true }),
    ).toBeNull();
  },
);

test('selects Driver Home when a rider on Activity becomes a driver', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));
  expect(screen.getByRole('header', { name: 'Activity' })).toBeOnTheScreen();

  await act(() => session.getState().signedIn(me('driver')));

  expect(screen.getByRole('header', { name: 'Driver home' })).toBeOnTheScreen();
  expect(
    screen.getByRole('tab', { name: 'Home', selected: true }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: 'Earnings' })).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: 'Account' })).toBeOnTheScreen();
  expect(
    screen.queryByRole('tab', {
      name: 'Activity',
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(
    screen.queryByRole('header', {
      name: 'Activity',
      includeHiddenElements: true,
    }),
  ).toBeNull();
});

test('removes the tabs when a user signs out from Account', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  expect(screen.getByRole('header', { name: 'Account' })).toBeOnTheScreen();

  await act(() => session.getState().signedOut());

  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(
    screen.queryByRole('tablist', { includeHiddenElements: true }),
  ).toBeNull();
});

test.each([
  { roles: ['rider'], middle: 'Activity' },
  { roles: ['driver'], middle: 'Earnings' },
  { roles: ['rider', 'driver'], middle: 'Earnings' },
] satisfies { roles: Me['roles']; middle: string }[])(
  'shows Home, $middle and Account tabs for $roles',
  async ({ roles, middle }) => {
    const { session, appConfig, navigator } = setup();
    session.getState().signedIn(me(...roles));
    appConfig.getState().setGate({ status: 'ok' });
    await render(navigator);

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    for (const name of ['Home', middle, 'Account']) {
      expect(screen.getByRole('tab', { name })).toBeOnTheScreen();
    }
  },
);

test.each([
  { role: 'rider', middle: 'Activity' },
  { role: 'driver', middle: 'Earnings' },
] as const)('opens each $role tab placeholder', async ({ role, middle }) => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me(role));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  for (const name of [middle, 'Account']) {
    await fireEvent.press(screen.getByRole('tab', { name }));
    expect(screen.getByRole('header', { name })).toBeOnTheScreen();
    expect(screen.getByText('Coming soon.')).toBeOnTheScreen();
  }
});

test('opens the root Debug screen from the Home tab', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  expect(
    screen.getByRole('tab', { name: 'Home', selected: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(screen.getByRole('header', { name: 'Debug tools' })).toBeOnTheScreen();
});

test('omits the Debug button from the Activity tab in development', async () => {
  jest.replaceProperty(runtime, '__DEV__', true);
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));
  expect(screen.getByRole('header', { name: 'Activity' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Debug' })).toBeNull();
});

test('leaves the bottom safe-area inset to the tab bar', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  const [contentArea] = screen.container.queryAll(
    node =>
      node.type === 'RNCSafeAreaView' &&
      node.props.accessibilityRole !== 'tablist',
  );
  expect(contentArea?.props.edges).toHaveProperty('bottom', 'off');
});

test('opens the store URL and disables the update button while opening', async () => {
  let resolveLink!: () => void;
  const open = jest.spyOn(Linking, 'openURL').mockImplementation(
    () =>
      new Promise(resolve => {
        resolveLink = resolve;
      }),
  );
  const { session, appConfig, navigator } = setup();
  session.getState().signedOut();
  appConfig.getState().setGate({ status: 'update_required', storeUrl });
  await render(navigator);
  expect(
    screen.getByRole('header', { name: 'Update required' }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Debug' })).toBeNull();

  const update = () => screen.getByRole('button', { name: 'Open app store' });
  await fireEvent.press(update());
  expect(open).toHaveBeenCalledWith(storeUrl);
  expect(update()).toBeDisabled();
  expect(update()).toBeBusy();
  await fireEvent.press(update());
  expect(open).toHaveBeenCalledTimes(1);

  await act(() => resolveLink());
  expect(update()).toBeEnabled();
});

test('ignores a second update press before the loading state renders', async () => {
  let resolveLink!: () => void;
  const pending = new Promise<void>(resolve => {
    resolveLink = resolve;
  });
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockClear()
    .mockReturnValue(pending);
  const { session, appConfig, navigator } = setup();
  session.getState().signedOut();
  appConfig.getState().setGate({ status: 'update_required', storeUrl });
  await render(navigator);

  const update = () => screen.getByRole('button', { name: 'Open app store' });
  await act(async () => {
    await fireEvent.press(update());
    expect(update()).toBeEnabled();
    await fireEvent.press(update());
  });
  expect(open).toHaveBeenCalledTimes(1);

  await act(() => resolveLink());
  await fireEvent.press(update());
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenLastCalledWith(storeUrl);
});

test('shows a retryable inline error if the store link fails', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('unavailable'));
  const { session, appConfig, navigator } = setup();
  session.getState().signedOut();
  appConfig.getState().setGate({ status: 'update_required', storeUrl });
  await render(navigator);

  await fireEvent.press(screen.getByRole('button', { name: 'Open app store' }));
  expect(
    screen.getByText('Could not open the app store. Try again.'),
  ).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(screen.getByRole('button', { name: 'Open app store' })).toBeEnabled();
});

test('replaces home with maintenance when the gate changes while signed in', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);
  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();

  await act(() => appConfig.getState().setGate({ status: 'maintenance' }));
  expect(screen.queryByRole('header', { name: 'Rider home' })).toBeNull();
  expect(
    screen.getByRole('header', { name: 'Under maintenance' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      'Lern is temporarily unavailable. Please try again later.',
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Debug' })).toBeNull();
});

test.each([true, false])(
  'shows Debug on login and both homes when __DEV__ is %s',
  async isDev => {
    jest.replaceProperty(runtime, '__DEV__', isDev);
    const { session, appConfig, navigator } = setup();
    session.getState().signedOut();
    appConfig.getState().setGate({ status: 'ok' });
    await render(navigator);

    const checkDebug = () => {
      const button = screen.queryByRole('button', { name: 'Debug' });
      if (isDev) expect(button).toBeOnTheScreen();
      else expect(button).toBeNull();
    };
    expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
    checkDebug();
    await act(() => session.getState().signedIn(me('rider')));
    checkDebug();
    await act(() => session.getState().signedIn(me('driver')));
    checkDebug();
  },
);

test('opens Debug and drops it from the stack when the session changes', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedOut();
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(screen.getByRole('header', { name: 'Debug tools' })).toBeOnTheScreen();
  expect(
    screen.container
      .queryAll(node => node.type === 'RNSScreenStackHeaderConfig')
      .map(header => header.props.backTitle),
  ).toContain('Back');

  await act(() => session.getState().signedIn(me('driver')));
  expect(screen.queryByRole('header', { name: 'Debug tools' })).toBeNull();
  expect(screen.getByRole('header', { name: 'Driver home' })).toBeOnTheScreen();
});

test('updates the screen background from the light to the dark token', async () => {
  const ColorSchemeContext = createContext<'light' | 'dark'>('light');
  mockColorScheme.mockImplementation(function useTestColorScheme() {
    return useContext(ColorSchemeContext);
  });
  const { session, appConfig, navigator } = setup();
  session.getState().signedOut();
  appConfig.getState().setGate({ status: 'ok' });
  const withScheme = (scheme: 'light' | 'dark') => (
    <ColorSchemeContext.Provider value={scheme}>
      {navigator}
    </ColorSchemeContext.Provider>
  );
  const { rerender } = await render(withScheme('light'));

  const background = () => {
    const [area] = screen.container.queryAll(
      node => node.type === 'RNCSafeAreaView',
    );
    return StyleSheet.flatten(area?.props.style)?.backgroundColor;
  };
  expect(background()).toBe(themes.light.background);

  await rerender(withScheme('dark'));
  expect(background()).toBe(themes.dark.background);
});
