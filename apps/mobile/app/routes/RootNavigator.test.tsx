import type { Me } from '@lern/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createContext, useContext } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
} from 'react-native';
import { createStore } from 'zustand/vanilla';
import { themes } from '@theme';
import { InteractionContext } from '../hooks/use-interaction';
import type { NotificationTarget } from '../boot/core';
import { createActiveRideStore } from '../stores/active-ride.store';
import { createAppConfigStore } from '../stores/app-config.store';
import { createConnectionStore } from '../stores/connection.store';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { createSecurityStore } from '../stores/security.store';
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

function setup(
  foreground = true,
  debug = <Text accessibilityRole="header">Debug tools</Text>,
) {
  const session = createSessionStore();
  const security = createSecurityStore();
  const appConfig = createAppConfigStore();
  const driverMode = createDriverModeStore();
  driverMode.setState({ verification: 'pending' });
  const connection = createConnectionStore();
  const getCurrentLocation = jest.fn(async () => ({
    status: 'ok' as const,
    point: { lat: 11.57, lng: 104.93 },
  }));
  const requestLocationPermission = jest.fn(async () => 'always' as const);
  const notification = createStore<NotificationTarget | null>()(() => null);
  const requestOtp = jest
    .fn<Promise<undefined>, [string]>()
    .mockResolvedValue(undefined);
  const signIn = jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined);
  const enableLock = jest.fn(async () =>
    security.getState().update({ enabled: true }),
  );
  const core = {
    stores: {
      session,
      security,
      appConfig,
      notification,
      driverMode,
      connection,
      activeRide: createActiveRideStore(),
    },
    api: { requestOtp, quote: jest.fn() },
    book: jest.fn(),
    setOnline: jest.fn(),
    refreshAvailability: jest.fn(),
    accept: jest.fn(),
    decline: jest.fn(),
    step: jest.fn(),
    cancel: jest.fn(),
    queue: {
      pending: () => ({ steps: [], points: 0 }),
      subscribeSteps: () => () => {},
    },
    signIn,
    becomeDriver: jest.fn(async () => {
      session.getState().signedIn(me('rider', 'driver'));
    }),
    unlock: jest.fn(async () => {
      security.getState().update({ locked: false });
      return { ok: true as const };
    }),
    signOut: jest.fn(),
    enableLock,
    interruptPinCheck: jest.fn(),
    pinWaitMs: () => 0,
  };
  const navigator = (
    <RootNavigator
      core={core}
      foreground={foreground}
      debug={debug}
      getCurrentLocation={getCurrentLocation}
      requestLocationPermission={requestLocationPermission}
      refreshLocationPermission={jest.fn()}
    />
  );
  return {
    core,
    enableLock,
    session,
    security,
    appConfig,
    notification,
    navigator,
    getCurrentLocation,
    requestOtp,
    requestLocationPermission,
    signIn,
  };
}

test('wires the driver Home toggle to the injected permission and core action', async () => {
  const { core, session, appConfig, navigator, requestLocationPermission } =
    setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  core.stores.driverMode.setState({
    availability: 'offline',
    verification: 'verified',
  });
  core.stores.connection.getState().setConnected(true);
  await render(navigator);
  await fireEvent.press(screen.getByRole('button', { name: 'Go online' }));

  expect(requestLocationPermission).toHaveBeenCalledTimes(1);
  expect(core.setOnline).toHaveBeenCalledWith(true);
});

test('wires rider Home GPS, quote and booking to their injected actions', async () => {
  const { core, session, appConfig, navigator, getCurrentLocation } = setup();
  const pickup = { lat: 11.57, lng: 104.93 };
  const dropoff = { lat: 11.5696, lng: 104.9211 };
  const fare = { amountMinor: 5000, currency: 'KHR' } as const;
  core.api.quote.mockResolvedValue({
    id: 'quote-1',
    vehicleType: 'moto',
    distanceM: 1850,
    fare,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  core.book.mockImplementation(async () => {
    core.stores.activeRide.getState().applyRide(
      {
        id: 'ride-1',
        status: 'searching',
        version: 1,
        vehicleType: 'moto',
        pickup,
        dropoff,
        fare,
      },
      'rider',
    );
  });
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  core.stores.connection.getState().setConnected(true);
  await render(navigator);

  await fireEvent.press(
    screen.getByRole('button', { name: 'Use current location' }),
  );
  expect(getCurrentLocation).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Central Market' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Get fare quote' }));
  expect(core.api.quote).toHaveBeenCalledWith({
    pickup,
    dropoff,
    vehicleType: 'moto',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Book ride' }));
  expect(core.book).toHaveBeenCalledWith('quote-1', expect.any(String));
  expect(screen.getByText('Looking for a driver')).toBeOnTheScreen();
});

test('wires the driver Home offer and its actions to core', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  core.stores.driverMode.setState({
    availability: 'reserved',
    verification: 'verified',
  });
  core.stores.connection.getState().setConnected(true);
  core.stores.activeRide.getState().applyOffer({
    id: 'offer-1',
    rideId: 'ride-1',
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    distanceM: 850,
    vehicleType: 'remork',
    pickup: { lat: 11.55, lng: 104.92 },
    dropoff: { lat: 11.54, lng: 104.92 },
    fare: { amountMinor: 12_000, currency: 'KHR' },
  });
  await render(navigator);
  await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Decline' }));

  expect(core.accept).toHaveBeenCalledWith('offer-1');
  expect(core.decline).toHaveBeenCalledWith('offer-1');
});

test('keeps Rider Home free of inline reconnecting banners', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  const { connection } = core.stores;

  await render(navigator);
  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
  expect(screen.queryByText('Reconnecting…')).toBeNull();

  await act(() => connection.getState().setConnected(true));
  expect(screen.queryByRole('alert')).toBeNull();

  await act(() => connection.getState().setConnected(false));
  expect(screen.queryByText('Reconnecting…')).toBeNull();
});

test('keeps a locked rider’s notification queued after navigation is ready', async () => {
  const { session, security, appConfig, notification, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  security.getState().update({ enabled: true, locked: true });
  const target = {
    type: 'ride',
    id: 'ride-1',
    status: 'driver_arrived',
  } as const;
  notification.setState(target, true);
  await render(navigator);
  expect(notification.getState()).toBe(target);
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(screen.getByLabelText('6-digit PIN')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
  expect(
    screen.getByRole('header', { name: 'Driver arrived' }),
  ).toBeOnTheScreen();
  expect(notification.getState()).toBeNull();
});

test('enrolls from Account after both PIN entries match', async () => {
  const { enableLock, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Set up app lock' }),
  );
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.changeText(screen.getByLabelText('Confirm PIN'), '123457');
  await fireEvent.press(screen.getByRole('button', { name: 'Save PIN' }));
  expect(enableLock).not.toHaveBeenCalled();
  expect(screen.getByText('The PINs must match.')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Confirm PIN'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Save PIN' }));
  expect(enableLock).toHaveBeenCalledWith('123456');
  expect(screen.getByText('App lock is on.')).toBeOnTheScreen();
});

test('opens the driver application from rider Account and resets to Driver Home on success', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  expect(
    screen.getByRole('button', { name: 'Set up app lock' }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Drive with Lern' }),
  );
  expect(
    screen.container
      .queryAll(node => node.type === 'RNSScreenStackHeaderConfig')
      .map(header => header.props),
  ).toContainEqual(
    expect.objectContaining({ title: 'Drive with Lern', backTitle: 'Back' }),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Motorbike' }));
  await fireEvent.changeText(screen.getByLabelText('License plate'), 'PP 1');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Send application' }),
  );

  expect(core.becomeDriver).toHaveBeenCalledWith({
    vehicleType: 'moto',
    plate: 'PP 1',
  });
  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('tab', { name: 'Home', selected: true }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByLabelText('License plate', { includeHiddenElements: true }),
  ).toBeNull();
});

test('driver Account keeps app-lock enrollment and hides the application action', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider', 'driver'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);

  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  expect(
    screen.getByRole('button', { name: 'Set up app lock' }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Drive with Lern' })).toBeNull();
});

test('requires a fresh PIN for signed-in Debug and cancels without opening it', async () => {
  const { security, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  security.getState().update({ enabled: true });
  await render(navigator);
  const openDebug = () =>
    fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  await openDebug();
  expect(screen.queryByText('Debug tools')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  await openDebug();
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Debug tools')).toBeOnTheScreen();
});

test('leaves the notification queued while the app is backgrounded', async () => {
  const { session, appConfig, navigator, notification } = setup(false);
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  const target = {
    type: 'ride',
    status: 'driver_arrived',
    id: 'ride-1',
  } as const;
  notification.setState(target, true);
  await render(navigator);
  expect(notification.getState()).toBe(target);
});

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
  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();

  await act(() => session.getState().signedOut());
  expect(
    screen.queryByRole('header', { name: 'Application under review' }),
  ).toBeNull();
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
});

test.each([
  ['rider', 'Rider home'],
  ['driver', 'Application under review'],
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

  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();
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
    if (name === 'Account')
      expect(
        screen.getByRole('button', { name: 'Set up app lock' }),
      ).toBeOnTheScreen();
    else expect(screen.getByText('Coming soon.')).toBeOnTheScreen();
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

test('opens a notification status in the signed-in stack and returns to the selected tab', async () => {
  const { session, appConfig, notification, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);
  await fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));

  await act(() =>
    notification.setState(
      { type: 'ride', id: 'ride-1', status: 'driver_arrived' },
      true,
    ),
  );
  expect(
    screen.getByRole('header', { name: 'Driver arrived' }),
  ).toBeOnTheScreen();
  expect(notification.getState()).toBeNull();
  const [header] = screen.container.queryAll(
    node =>
      node.type === 'RNSScreenStackHeaderConfig' && node.props.title === 'Ride',
  );
  expect(header.props.backTitle).toBe('Back');
  const statusScreen = screen.container
    .queryAll(
      node =>
        node.type === 'RNSScreen' &&
        typeof node.props.onHeaderBackButtonClicked === 'function',
    )
    .at(-1)!;
  await fireEvent(statusScreen, 'headerBackButtonClicked');
  expect(screen.getByRole('header', { name: 'Activity' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Driver arrived' })).toBeNull();
});

test('opens a cold offer as soon as the driver stack mounts and drops it on sign-out', async () => {
  const { session, appConfig, notification, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  notification.setState({ type: 'offer', id: 'offer-1' }, true);
  await render(navigator);
  expect(screen.getByRole('header', { name: 'Offer pending' })).toBeOnTheScreen();

  await act(() => session.getState().signedOut());
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Offer pending' })).toBeNull();
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
  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();
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

test('closing the protected stack also dismisses an open modal across unlock', async () => {
  const { session, security, appConfig, navigator } = setup(
    true,
    <Modal visible>
      <Text>Ride detail modal</Text>
    </Modal>,
  );
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(screen.getByText('Ride detail modal')).toBeOnTheScreen();
  await act(() => security.getState().update({ enabled: true, locked: true }));
  expect(screen.queryByText('Ride detail modal')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
  expect(screen.getByText('Application under review')).toBeOnTheScreen();
  expect(screen.queryByText('Ride detail modal')).toBeNull();
});

test('drops an open Debug route when a different driver signs in', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  await render(navigator);
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(screen.getByText('Debug tools')).toBeOnTheScreen();
  await act(() =>
    session.getState().signedIn({ ...me('driver'), id: 'second-driver' }),
  );
  expect(screen.queryByText('Debug tools')).toBeNull();
});

test('tab activation, form buttons and keyboard edits all report interaction', async () => {
  const { session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  const interact = jest.fn(() => true);
  await render(
    <InteractionContext.Provider value={interact}>
      {navigator}
    </InteractionContext.Provider>,
  );
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  expect(interact).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Set up app lock' }),
  );
  expect(interact).toHaveBeenCalledTimes(2);
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '1');
  expect(interact).toHaveBeenCalledTimes(3);
});

test('lock countdown resumes from the remaining wait and permits signing out', async () => {
  jest.useFakeTimers();
  try {
    const { core, session, security, appConfig, navigator } = setup();
    session.getState().signedIn(me('rider'));
    appConfig.getState().setGate({ status: 'ok' });
    security.getState().update({ enabled: true, locked: true });
    let remaining = 2250;
    core.pinWaitMs = () => remaining;
    const view = await render(navigator);
    const timer = () => screen.getByText(/Try again in/);
    expect(timer()).toHaveTextContent(/3s/);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(core.signOut).toHaveBeenCalledTimes(1);
    await view.unmount();
    remaining = 750;
    await render(navigator);
    expect(timer()).toHaveTextContent(/1s/);
    expect(screen.getByLabelText('6-digit PIN')).toHaveProp('editable', false);
    remaining = 0;
    await act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByLabelText('6-digit PIN')).toHaveProp('editable', true);
  } finally {
    jest.useRealTimers();
  }
});

test('a storage rejection keeps enrollment open and a double press writes once', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  let reject!: (reason: Error) => void;
  core.enableLock.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await render(navigator);
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Set up app lock' }));
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.changeText(screen.getByLabelText('Confirm PIN'), '123456');
  const save = () => screen.getByRole('button', { name: 'Save PIN' });
  await act(async () => {
    await fireEvent.press(save());
    await fireEvent.press(save());
  });
  expect(core.enableLock).toHaveBeenCalledTimes(1);
  expect(save()).toBeBusy();
  await act(() => reject(new Error('Storage unavailable')));
  expect(save()).toBeEnabled();
  expect(screen.getByText('Something went wrong. Try again.')).toBeOnTheScreen();
});

test('denies the button and text callbacks when the interaction expires', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('rider'));
  appConfig.getState().setGate({ status: 'ok' });
  const interact = jest.fn(() => true);
  await render(
    <InteractionContext.Provider value={interact}>
      {navigator}
    </InteractionContext.Provider>,
  );
  interact.mockReturnValue(false);
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  expect(screen.getByText('Rider home')).toBeOnTheScreen();
  interact.mockReturnValue(true);
  await fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Set up app lock' }),
  );
  const field = screen.getByLabelText('6-digit PIN');
  interact.mockReturnValue(false);
  await fireEvent.changeText(field, '123456');
  expect(field.props.value).toBe('');
  interact.mockReturnValue(true);
  await fireEvent.changeText(field, '123456');
  await fireEvent.changeText(screen.getByLabelText('Confirm PIN'), '123456');
  interact.mockReturnValue(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Save PIN' }));
  expect(core.enableLock).not.toHaveBeenCalled();
});

test('wires driver ride step and cancellation to core', async () => {
  const { core, session, appConfig, navigator } = setup();
  session.getState().signedIn(me('driver'));
  appConfig.getState().setGate({ status: 'ok' });
  core.stores.driverMode.setState({
    availability: 'on_trip',
    verification: 'verified',
  });
  core.stores.connection.getState().setConnected(true);
  const activeRide = core.stores.activeRide;
  const ride = {
    id: 'ride-1',
    status: 'driver_assigned',
    version: 1,
    vehicleType: 'remork',
    pickup: { lat: 11.55, lng: 104.92 },
    dropoff: { lat: 11.54, lng: 104.92 },
    fare: { amountMinor: 12_000, currency: 'KHR' },
  } as const;
  activeRide.getState().applyRide(ride, 'driver');
  core.step.mockImplementationOnce(async () => {
    activeRide
      .getState()
      .applyRide({ ...ride, status: 'driver_arrived', version: 2 }, 'driver');
  });
  core.cancel.mockImplementationOnce(async () => {
    activeRide
      .getState()
      .applyRide({ ...ride, status: 'cancelled', version: 3 }, 'driver');
  });
  await render(navigator);

  await fireEvent.press(
    screen.getByRole('button', { name: 'Arrived at pickup' }),
  );
  expect(core.step).toHaveBeenCalledWith(ride.id, 'arrive');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel ride' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm cancellation' }),
  );
  expect(core.cancel).toHaveBeenCalledWith(ride.id, 'other');
  expect(
    screen.getByRole('header', { name: 'Ride cancelled' }),
  ).toBeOnTheScreen();
});

const riderTrip = {
  id: 'ride-rider',
  status: 'driver_assigned',
  version: 1,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 12_000, currency: 'KHR' },
} as const;

function riderWithActiveTrip() {
  const result = setup();
  result.session.getState().signedIn(me('rider'));
  result.appConfig.getState().setGate({ status: 'ok' });
  result.core.stores.connection.getState().setConnected(true);
  result.core.stores.activeRide.getState().applyRide(riderTrip, 'rider');
  return result;
}

test('wires rider cancellation to core with a reason and retry key', async () => {
  const { core, navigator } = riderWithActiveTrip();
  core.cancel.mockImplementationOnce(async () => {
    core.stores.activeRide
      .getState()
      .applyRide({ ...riderTrip, status: 'cancelled', version: 2 }, 'rider');
  });
  await render(navigator);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel ride' }));
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Driver not moving' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm cancellation' }),
  );
  expect(core.cancel).toHaveBeenCalledWith(
    riderTrip.id,
    'driver_not_moving',
    expect.any(String),
  );
  expect(
    screen.getByRole('header', { name: 'Ride cancelled' }),
  ).toBeOnTheScreen();
});

test('opens the protected live ride map with current pins and a back header', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockClear();
  const { core, navigator } = riderWithActiveTrip();
  core.stores.activeRide
    .getState()
    .applyPosition({
      lat: 11.57,
      lng: 104.93,
      rideId: riderTrip.id,
      recordedAt: '2026-11-26T00:00:00Z',
    });
  await render(navigator);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open live ride map' }),
  );
  const [header] = screen.container.queryAll(
    node =>
      node.type === 'RNSScreenStackHeaderConfig' &&
      node.props.title === 'Live ride map',
  );
  expect(header.props.backTitle).toBe('Back');
  const map = screen.getByLabelText('Live ride map');
  expect(map).toHaveProp('scrollEnabled', true);
  expect(
    screen.getAllByTestId('map-marker').map(pin => pin.props.title),
  ).toEqual(['Pickup', 'Dropoff', 'Driver']);
  await act(() =>
    core.stores.activeRide
      .getState()
      .applyRide(
        { ...riderTrip, status: 'driver_arrived', version: 2 },
        'rider',
      ),
  );
  expect(announce.mock.calls).toEqual([['Driver arrived']]);
  await act(() =>
    core.stores.activeRide
      .getState()
      .applyRide({ ...riderTrip, status: 'completed', version: 3 }, 'rider'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Back to ride' }));
  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
  expect(screen.queryByLabelText('Live ride map')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Book another ride' }),
  ).toBeOnTheScreen();
  expect(announce.mock.calls).toEqual([['Driver arrived'], ['Ride completed']]);
});

test('announces a stale driver location once while the ride map is open', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockClear();
  const { core, navigator } = riderWithActiveTrip();
  await render(navigator);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open live ride map' }),
  );
  await act(() =>
    core.stores.activeRide.getState().applyConnectivity({
      rideId: riderTrip.id,
      stale: true,
      lastSeenAt: '2026-11-26T00:00:00Z',
    }),
  );
  const message =
    'Driver location hasn’t updated recently. Trying to reconnect.';
  expect(screen.getByRole('alert', { name: message })).toBeOnTheScreen();
  expect(announce.mock.calls).toEqual([[message]]);
});

test('keeps an ended rider ride dismissed after locking and unlocking', async () => {
  const { core, security, navigator } = riderWithActiveTrip();
  core.stores.activeRide
    .getState()
    .applyRide({ ...riderTrip, status: 'completed', version: 2 }, 'rider');
  await render(navigator);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Book another ride' }),
  );
  expect(
    screen.getByRole('button', { name: 'Get fare quote' }),
  ).toBeOnTheScreen();

  await act(() => security.getState().update({ enabled: true, locked: true }));
  await fireEvent.changeText(screen.getByLabelText('6-digit PIN'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));

  expect(core.unlock).toHaveBeenCalledWith('123456');
  expect(
    screen.queryByRole('button', { name: 'Book another ride' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Get fare quote' }),
  ).toBeOnTheScreen();
});
