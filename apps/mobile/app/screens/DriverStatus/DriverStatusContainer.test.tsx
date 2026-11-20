import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Platform,
  useColorScheme,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { themes } from '@theme';
import { ApiError } from '../../services/api.service';
import type { Permission } from '../../services/location.service';
import { createConnectionStore } from '../../stores/connection.store';
import { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusContainer from './DriverStatusContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

beforeEach(() => jest.mocked(useColorScheme).mockReturnValue('light'));
afterEach(() => jest.restoreAllMocks());

function setup(verification: 'verified' | null = 'verified') {
  const driverMode = createDriverModeStore();
  driverMode.setState({ verification, availability: 'offline' });
  const connection = createConnectionStore();
  connection.getState().setConnected(true);
  const props = {
    driverMode,
    connection,
    requestLocationPermission: jest.fn(
      async (): Promise<Permission> => 'always',
    ),
    refreshLocationPermission: jest.fn(),
    setOnline: jest.fn<Promise<void>, [boolean]>().mockResolvedValue(undefined),
    refreshAvailability: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
  };
  return {
    ...props,
    render: () => render(<DriverStatusContainer {...props} />),
    props,
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const locationNeeded = 'Allow location access to receive offers.';
const foregroundOnly = 'You’ll only receive offers while the app is open.';

test('shows loading, keeps Debug available and updates when the store receives a status', async () => {
  const { driverMode, props } = setup(null);
  const onDebug = jest.fn();
  await render(<DriverStatusContainer {...props} onDebug={onDebug} />);
  expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeBusy();
  await fireEvent.press(screen.getByRole('button', { name: 'Debug' }));
  expect(onDebug).toHaveBeenCalledTimes(1);

  await act(() => driverMode.setState({ verification: 'pending' }));
  expect(screen.queryByRole('progressbar', { name: 'Loading' })).toBeNull();
  expect(
    screen.getByRole('header', { name: 'Application under review' }),
  ).toBeOnTheScreen();
  await act(() => driverMode.setState({ verification: 'verified' }));
  expect(
    screen.getByRole('header', { name: 'You’re verified' }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Debug' })).toBeOnTheScreen();
});

test.each([
  [
    'pending',
    'Application under review',
    'We’re checking your details. You can go online once you’re verified. This screen will update when the review is done.',
  ],
  ['verified', 'You’re verified', 'Go online to start receiving offers.'],
  [
    'suspended',
    'Driver account suspended',
    'You can’t go online for now. Contact Lern support to find out why and what you can do to fix it.',
  ],
  ['banned', 'Driver account closed', 'You can no longer drive with Lern.'],
] as const)(
  'shows the title and next steps for %s',
  async (verification, title, body) => {
    const home = setup();
    const { driverMode } = home;
    driverMode.setState({ verification });
    await home.render();

    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText(body)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Debug' })).toBeNull();
    if (verification !== 'verified')
      expect(screen.queryByRole('button', { name: 'Go online' })).toBeNull();
  },
);

test('waits for permission and uses the server availability for both toggle labels', async () => {
  const {
    render: renderHome,
    driverMode,
    setOnline,
    requestLocationPermission,
  } = setup();
  let grant!: (permission: Permission) => void;
  requestLocationPermission.mockReturnValueOnce(
    new Promise(resolve => {
      grant = resolve;
    }),
  );
  await renderHome();

  expect(screen.getByText('Offline')).toBeOnTheScreen();
  await fireEvent.press(button('Go online'));
  expect(button('Go online')).toBeBusy();
  expect(setOnline).not.toHaveBeenCalled();
  await act(() => grant('always'));
  expect(setOnline).toHaveBeenCalledWith(true);
  expect(button('Go online')).toBeEnabled();

  await act(() => driverMode.getState().setAvailability('available'));
  expect(screen.getByText('Online')).toBeOnTheScreen();
  await fireEvent.press(button('Go offline'));
  expect(requestLocationPermission).toHaveBeenCalledTimes(1);
  expect(setOnline.mock.calls).toEqual([[true], [false]]);
  expect(button('Go offline')).toBeEnabled();
});

test('hides the invitation to go online when the driver is already available', async () => {
  const home = setup();
  home.driverMode.getState().setAvailability('available');
  await home.render();

  expect(screen.getByText('Online')).toBeOnTheScreen();
  expect(screen.queryByText('Go online to start receiving offers.')).toBeNull();
});

test.each([
  ['ios', [['Online'], ['Offline']]],
  ['android', []],
] as const)(
  'uses the platform announcement behavior for availability changes on %s',
  async (platform, expectedCalls) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockClear()
      .mockImplementation(() => undefined);
    const home = setup();
    await home.render();
    expect(announce).not.toHaveBeenCalled();

    await act(() => home.driverMode.getState().setAvailability('available'));
    await act(() => home.driverMode.getState().setAvailability('offline'));

    expect(announce.mock.calls).toEqual(expectedCalls);
  },
);

test('does not announce hidden availability for a pending driver on iOS', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockClear()
    .mockImplementation(() => undefined);
  const home = setup();
  home.driverMode.setState({ verification: 'pending' });
  await home.render();
  await act(() => home.driverMode.getState().setAvailability('available'));

  expect(announce).not.toHaveBeenCalled();
});

test.each([
  [null, 'Loading availability…'],
  ['reserved', 'Offer pending'],
  ['on_trip', 'On a trip'],
] as const)(
  'shows %s availability without a toggle',
  async (availability, label) => {
    const home = setup();
    home.driverMode.getState().setAvailability(availability);
    await home.render();
    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Go (online|offline)/ }),
    ).toBeNull();
  },
);

test('denied permission keeps the driver offline and offers to open Settings', async () => {
  const home = setup();
  const openSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  home.requestLocationPermission.mockResolvedValue('denied');
  await home.render();
  await fireEvent.press(button('Go online'));

  expect(home.setOnline).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(locationNeeded);
  expect(screen.getByRole('alert')).toHaveStyle({
    borderLeftColor: themes.light.danger,
  });
  expect(screen.getByText('Offline')).toBeOnTheScreen();
  await fireEvent.press(button('Open Settings'));
  expect(openSettings).toHaveBeenCalledTimes(1);
});

test('foreground permission allows online and shows a warning and Settings in dark mode', async () => {
  const home = setup();
  jest.mocked(useColorScheme).mockReturnValue('dark');
  home.requestLocationPermission.mockResolvedValue('foreground');
  home.setOnline.mockImplementation(async () =>
    home.driverMode.getState().setAvailability('available'),
  );
  await home.render();
  await fireEvent.press(button('Go online'));

  expect(home.setOnline).toHaveBeenCalledWith(true);
  expect(button('Go offline')).toBeOnTheScreen();
  expect(screen.getByRole('alert')).toHaveTextContent(foregroundOnly);
  expect(screen.getByRole('alert')).toHaveStyle({
    borderLeftColor: themes.dark.warning,
  });
  expect(button('Open Settings')).toBeEnabled();
});

test('asks for the current permission when returning to the app', async () => {
  const home = setup();
  let change!: (state: AppStateStatus) => void;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      change = listener;
      return { remove: jest.fn() };
    });
  await home.render();
  home.refreshLocationPermission.mockClear();
  await act(() => change('background'));
  expect(home.refreshLocationPermission).not.toHaveBeenCalled();
  await act(() => change('active'));
  expect(home.refreshLocationPermission).toHaveBeenCalledTimes(1);
});

test('does not check location permission for a pending driver', async () => {
  const home = setup();
  home.driverMode.setState({ verification: 'pending' });
  await home.render();

  expect(home.refreshLocationPermission).not.toHaveBeenCalled();
});

test('removes the AppState listener when Home unmounts', async () => {
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  const home = setup();
  const view = await home.render();
  await view.unmount();

  expect(remove).toHaveBeenCalledTimes(1);
});

test.each(['denied', 'failed'] as const)(
  'shows the danger message when tracking reports %s independently of a tap',
  async locationPermission => {
    const home = setup();
    await home.render();
    await act(() => home.driverMode.setState({ locationPermission }));
    expect(screen.getByRole('alert')).toHaveTextContent(locationNeeded);
    expect(button('Open Settings')).toBeEnabled();
  },
);

test('disables the toggle while reconnecting and enables it when the socket returns', async () => {
  const home = setup();
  await home.render();
  await act(() => home.connection.getState().setConnected(false));
  expect(screen.getByRole('alert')).toHaveTextContent('Reconnecting…');
  expect(button('Go online')).toBeDisabled();
  await fireEvent.press(button('Go online'));
  expect(home.requestLocationPermission).not.toHaveBeenCalled();
  expect(home.setOnline).not.toHaveBeenCalled();

  await act(() => home.connection.getState().setConnected(true));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(button('Go online')).toBeEnabled();
});

test('does not go online if the socket disconnects while permission is pending', async () => {
  const home = setup();
  let grant!: (permission: Permission) => void;
  home.requestLocationPermission.mockReturnValueOnce(
    new Promise(resolve => {
      grant = resolve;
    }),
  );
  await home.render();
  await fireEvent.press(button('Go online'));
  await act(() => home.connection.getState().setConnected(false));
  await act(() => grant('always'));

  expect(screen.getByRole('alert')).toHaveTextContent('Reconnecting…');
  expect(button('Go online')).toBeDisabled();
  expect(home.setOnline).not.toHaveBeenCalled();
});

test.each([
  ['suspended', { verification: 'suspended' }],
  ['reserved', { availability: 'reserved' }],
] as const)(
  'does not go online if the driver becomes %s while permission is pending',
  async (_status, update) => {
    const home = setup();
    let grant!: (permission: Permission) => void;
    home.requestLocationPermission.mockReturnValueOnce(
      new Promise(resolve => {
        grant = resolve;
      }),
    );
    await home.render();
    await fireEvent.press(button('Go online'));
    await act(() => home.driverMode.setState(update));
    await act(() => grant('always'));

    expect(home.setOnline).not.toHaveBeenCalled();
  },
);

test('ignores a press on an older toggle after server availability changes', async () => {
  const home = setup();
  await home.render();
  await act(async () => {
    home.driverMode.getState().setAvailability('available');
    await fireEvent.press(button('Go online'));
  });

  expect(home.requestLocationPermission).not.toHaveBeenCalled();
  expect(home.setOnline).not.toHaveBeenCalled();
  expect(button('Go offline')).toBeEnabled();
});

test('ignores permission granted after Home unmounts', async () => {
  const home = setup();
  let grant!: (permission: Permission) => void;
  home.requestLocationPermission.mockReturnValueOnce(
    new Promise(resolve => {
      grant = resolve;
    }),
  );
  const homeView = await home.render();
  await fireEvent.press(button('Go online'));
  await homeView.unmount();
  await act(() => grant('always'));

  expect(home.setOnline).not.toHaveBeenCalled();
  expect(home.driverMode.getState().locationPermission).toBeNull();
});

test.each([
  [0, 'No connection, try again'],
  [403, 'You can’t go online right now. Contact Lern support.'],
  [500, 'Something went wrong, try again'],
])('shows the correct toggle error for status %s', async (status, message) => {
  const home = setup();
  home.setOnline.mockRejectedValueOnce(new ApiError(status, {}));
  await home.render();
  await fireEvent.press(button('Go online'));

  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(button('Go online')).toBeEnabled();
  expect(home.refreshAvailability).not.toHaveBeenCalled();
});

test('clears the generic error when retrying successfully', async () => {
  const home = setup();
  home.setOnline
    .mockRejectedValueOnce(new ApiError(500, {}))
    .mockImplementationOnce(async () =>
      home.driverMode.getState().setAvailability('available'),
    );
  await home.render();
  await fireEvent.press(button('Go online'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Something went wrong, try again',
  );

  await fireEvent.press(button('Go online'));

  expect(screen.getByText('Online')).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('refreshes server availability on conflict without showing an error', async () => {
  const home = setup();
  home.driverMode.getState().setAvailability('available');
  home.setOnline.mockRejectedValueOnce(
    new ApiError(409, { availability: 'reserved' }),
  );
  home.refreshAvailability.mockImplementationOnce(async () =>
    home.driverMode.getState().setAvailability('reserved'),
  );
  await home.render();
  await fireEvent.press(button('Go offline'));

  expect(home.refreshAvailability).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Offer pending')).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('makes a single request across repeated taps and re-enables on completion', async () => {
  const home = setup();
  let grant!: (permission: Permission) => void;
  home.requestLocationPermission.mockReturnValueOnce(
    new Promise(resolve => {
      grant = resolve;
    }),
  );
  let finish!: () => void;
  home.setOnline.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await home.render();
  const toggle = button('Go online');
  await act(async () => {
    await fireEvent.press(toggle);
    expect(toggle).toBeEnabled();
    await fireEvent.press(toggle);
  });

  expect(home.requestLocationPermission).toHaveBeenCalledTimes(1);
  await act(() => grant('always'));
  await fireEvent.press(button('Go online'));
  expect(home.setOnline).toHaveBeenCalledTimes(1);
  expect(button('Go online')).toBeDisabled();
  expect(button('Go online')).toBeBusy();
  await act(() => finish());
  expect(button('Go online')).toBeEnabled();
});
