/**
 * @format
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { requireNativeModule } from 'expo';
import App from '../App';
import { core, startApp } from '../app/boot/app-core';

jest.mock('expo', () => {
  const privacy = {
    elapsed: () => 0,
    cycle: jest.fn(async () => 0),
    reveal: jest.fn(),
    invalidate: jest.fn(() => 0),
  };
  return { requireNativeModule: () => privacy };
});
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
      interruptPinCheck: jest.fn(),
      refreshAvailability: jest.fn(),
      setOnline: jest.fn(),
      accept: jest.fn(),
      decline: jest.fn(),
      pinWaitMs: () => 0,
      stores: {
        language,
        driverMode: jest
          .requireActual('../app/stores/driver-mode.store')
          .createDriverModeStore(),
        connection: jest
          .requireActual('../app/stores/connection.store')
          .createConnectionStore(),
        activeRide: jest
          .requireActual('../app/stores/active-ride.store')
          .createActiveRideStore(),
        security: jest
          .requireActual('../app/stores/security.store')
          .createSecurityStore(),
        session: createSessionStore(),
        appConfig: createAppConfigStore(),
        notification: createStore(() => null),
      },
    },
    requestLocationPermission: jest.fn(),
    refreshLocationPermission: jest.fn(),
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

test('shows one localized sync toast over the PIN lock', async () => {
  jest.useFakeTimers();
  const { appConfig, connection, security, session } = core.stores;
  try {
    await render(<App />);
    await act(() => {
      appConfig.getState().setGate({ status: 'ok' });
      session.getState().signedIn({
        id: 'locked-rider',
        phone: '+85512345678',
        roles: ['rider'],
      });
      security.getState().update({ enabled: true, locked: true });
      connection.setState({ network: false });
    });
    expect(
      screen.getByRole('header', { name: 'កម្មវិធីបានចាក់សោ' }),
    ).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTime(1000));
    expect(
      screen.getAllByRole('alert', { name: 'គ្មានអ៊ីនធឺណិត' }),
    ).toHaveLength(1);
  } finally {
    await act(() => {
      connection.setState(connection.getInitialState());
      security.setState(security.getInitialState());
      session.setState(session.getInitialState());
      appConfig.setState(appConfig.getInitialState());
    });
    jest.useRealTimers();
  }
});

test('reveals only the most recently activated native cycle after layout', async () => {
  const privacy = requireNativeModule<{
    cycle: jest.Mock<Promise<number>>;
    reveal: jest.Mock;
    invalidate: jest.Mock;
  }>('LernPrivacy');
  let change!: (status: AppStateStatus) => void;
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      change = listener;
      return { remove: jest.fn() };
    });
  try {
    await render(<App />);
    let previous!: (cycle: number) => void;
    privacy.cycle.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          previous = resolve;
        }),
    );
    await act(() => change('active'));
    await act(() => change('background'));
    privacy.cycle.mockResolvedValueOnce(2);
    await act(() => change('active'));
    await act(() => previous(1));
    expect(privacy.reveal).not.toHaveBeenCalled();
    const [marker] = screen.container.queryAll(
      node =>
        node.props.pointerEvents === 'none' &&
        typeof node.props.onLayout === 'function',
    );
    await fireEvent(marker, 'layout');
    expect(privacy.reveal).toHaveBeenCalledWith(
      2,
      expect.stringMatching(/^privacy-2-loading-/),
      false,
      0,
      0,
    );
    expect(core.refreshAvailability).toHaveBeenCalled();
    privacy.reveal.mockClear();
    let revision = 0;
    privacy.invalidate.mockImplementation(() => ++revision);
    const user = {
      id: 'first',
      phone: '+85512345678',
      roles: ['driver' as const],
    };
    await act(() => {
      core.stores.appConfig.getState().setGate({ status: 'ok' });
      core.stores.session.getState().signedIn(user);
      core.stores.security.getState().update({ enabled: true });
    });
    const firstDriver = screen.getByTestId(/^privacy-2-driver-/);
    await fireEvent(firstDriver, 'layout');
    expect(privacy.reveal).toHaveBeenCalledWith(
      2,
      firstDriver.props.testID,
      false,
      300000,
      revision,
    );
    const staleLayout = firstDriver.props.onLayout;
    await act(() =>
      core.stores.session.getState().signedIn({ ...user, id: 'second' }),
    );
    privacy.reveal.mockClear();
    await act(() => staleLayout());
    expect(privacy.reveal).not.toHaveBeenCalled();
    await act(() => core.stores.security.getState().update({ locked: true }));
    const lockMarker = screen.getByTestId(/^privacy-2-AppLock-/);
    await fireEvent(lockMarker, 'layout');
    expect(privacy.reveal).toHaveBeenCalledWith(
      2,
      lockMarker.props.testID,
      true,
      0,
      revision,
    );

  } finally {
    subscription.mockRestore();
  }
});
