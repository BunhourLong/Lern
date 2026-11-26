import type { CancelReason, Offer, Ride } from '@lern/contracts';
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
import type { QueuedStep } from '../../services/offline-queue.service';
import type { Permission } from '../../services/location.service';
import { createActiveRideStore } from '../../stores/active-ride.store';
import { createConnectionStore } from '../../stores/connection.store';
import { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusContainer from './DriverStatusContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => false,
}));

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
    activeRide: createActiveRideStore(),
    accept: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    decline: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    step: jest
      .fn<Promise<void>, [string, QueuedStep['action']]>()
      .mockResolvedValue(undefined),
    cancel: jest.fn<Promise<void>, [string, CancelReason]>().mockResolvedValue(undefined),
    pendingSteps: jest.fn<readonly QueuedStep[], []>(() => []),
    subscribePendingSteps: jest.fn((_listener: () => void) => () => {}),
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
    render: (now?: () => number) =>
      render(<DriverStatusContainer {...props} now={now} />),
    props,
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const locationNeeded = 'Allow location access to receive offers.';
const foregroundOnly = 'You’ll only receive offers while the app is open.';

const offerStart = Date.parse('2026-11-20T00:00:00.000Z');
const pendingOffer: Offer = {
  id: '00000000-0000-4000-8000-000000000001',
  rideId: '00000000-0000-4000-8000-000000000002',
  status: 'pending',
  expiresAt: new Date(offerStart + 10_000).toISOString(),
  distanceM: 850,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 12_000, currency: 'KHR' },
};
const driverRide: Ride = {
  id: pendingOffer.rideId,
  status: 'driver_assigned',
  version: 1,
  vehicleType: pendingOffer.vehicleType,
  pickup: pendingOffer.pickup,
  dropoff: pendingOffer.dropoff,
  fare: pendingOffer.fare,
};

function setupOffer(offer = pendingOffer) {
  const home = setup();
  home.driverMode.getState().setAvailability('reserved');
  home.activeRide.getState().applyOffer(offer);
  return { ...home, render: () => home.render(() => offerStart) };
}

const offerHeading = (name: string) => screen.getByRole('header', { name });
const queryOfferHeading = (name: string) =>
  screen.queryByRole('header', { name });

describe('driver Home offer', () => {
  test.each(['light', 'dark'] as const)(
    'shows the pickup mini-map in %s mode',
    async scheme => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      jest.mocked(useColorScheme).mockReturnValue(scheme);
      const home = setupOffer();
      await home.render();

      const coordinate = {
        latitude: pendingOffer.pickup.lat,
        longitude: pendingOffer.pickup.lng,
      };
      expect(
        screen.getByRole('image', { name: 'Pickup location map' }),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('map-view').props).toMatchObject({
        region: coordinate,
        userInterfaceStyle: scheme,
      });
      expect(screen.getByTestId('map-marker').props).toMatchObject({
        coordinate,
        title: 'Pickup',
        pinColor: themes[scheme].primary,
      });
    },
  );

  test('re-centers the pickup mini-map when a replacement offer arrives', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const home = setupOffer();
    await home.render();
    const pickup = { lat: 11.59, lng: 104.88 };
    await act(() =>
      home.activeRide.getState().applyOffer({
        ...pendingOffer,
        id: '00000000-0000-4000-8000-000000000003',
        pickup,
      }),
    );

    const coordinate = { latitude: pickup.lat, longitude: pickup.lng };
    expect(screen.getByTestId('map-view').props.region).toMatchObject(
      coordinate,
    );
    expect(screen.getByTestId('map-marker').props.coordinate).toEqual(coordinate);
  });

  test.each([
    [850, { amountMinor: 12_000, currency: 'KHR' }, '850 m', '12,000 ៛'],
    [1200, { amountMinor: 375, currency: 'USD' }, '1.2 km', '$3.75'],
  ] as const)(
    'shows a pending offer at %i metres',
    async (distanceM, fare, distance, price) => {
      const home = setupOffer({ ...pendingOffer, distanceM, fare });
      await home.render();

      expect(offerHeading('New ride offer')).toBeOnTheScreen();
      expect(
        screen.getByText(`Pickup distance: ${distance}`),
      ).toBeOnTheScreen();
      expect(screen.getByText(`Fare: ${price}`)).toBeOnTheScreen();
      expect(screen.getByText('Vehicle type: Remork')).toBeOnTheScreen();
      expect(screen.getByText('10 s remaining')).toBeOnTheScreen();
      expect(button('Accept')).toBeEnabled();
      expect(button('Decline')).toBeEnabled();
    },
  );

  test('shows and announces a held offer only after the driver is verified', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockClear()
      .mockImplementation(() => undefined);
    const home = setupOffer();
    home.driverMode.setState({ verification: 'pending' });
    await home.render();
    expect(queryOfferHeading('New ride offer')).toBeNull();
    expect(announce).not.toHaveBeenCalled();

    await act(() => home.driverMode.setState({ verification: 'verified' }));
    expect(offerHeading('New ride offer')).toBeOnTheScreen();
    expect(announce.mock.calls).toEqual([['New ride offer']]);
  });

  test('ticks to local expiry and announces arrival and expiry once on iOS', async () => {
    jest.useFakeTimers();
    const clockOffset = 60_000;
    jest.setSystemTime(offerStart + clockOffset);
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockClear()
      .mockImplementation(() => undefined);
    try {
      const home = setup();
      home.driverMode.getState().setAvailability('reserved');
      await home.render(() => Date.now() - clockOffset);
      await act(() => home.activeRide.getState().applyOffer(pendingOffer));
      expect(
        screen.getByText('10 s remaining').props.accessibilityLiveRegion,
      ).toBeUndefined();
      expect(announce.mock.calls).toEqual([['New ride offer']]);

      await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText('9 s remaining')).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledTimes(1);
      await act(() => jest.advanceTimersByTime(9000));

      expect(offerHeading('Offer expired')).toBeOnTheScreen();
      expect(screen.queryByTestId('map-view')).toBeNull();
      expect(screen.queryByLabelText('Pickup location map')).toBeNull();
      expect(button('Dismiss')).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: /Accept|Decline/ }),
      ).toBeNull();
      expect(home.activeRide.getState().offer?.status).toBe('pending');

      await act(() => {
        home.activeRide
          .getState()
          .applyOffer({ ...pendingOffer, status: 'expired' });
        jest.advanceTimersByTime(1000);
      });
      expect(announce.mock.calls).toEqual([
        ['New ride offer'],
        ['Offer expired'],
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('hides the offer after accepting when core applies the matching driver ride', async () => {
    const home = setupOffer();
    home.accept.mockImplementationOnce(async () => {
      home.activeRide.getState().applyRide(driverRide, 'driver');
    });
    await home.render();
    await act(() =>
      home.activeRide.getState().applyRide(
        { ...driverRide, id: 'other', status: 'completed' },
        'driver',
      ),
    );
    await fireEvent.press(button('Accept'));

    expect(home.accept).toHaveBeenCalledWith(pendingOffer.id);
    expect(home.activeRide.getState().driver?.id).toBe(pendingOffer.rideId);
    expect(queryOfferHeading('New ride offer')).toBeNull();
    expect(queryOfferHeading('Ride no longer available')).toBeNull();
  });

  test('hides the offer after declining when core applies the declined response', async () => {
    const home = setupOffer();
    home.decline.mockImplementationOnce(async () => {
      home.activeRide
        .getState()
        .applyOffer({ ...pendingOffer, status: 'declined' });
    });
    await home.render();
    await fireEvent.press(button('Decline'));

    expect(home.decline).toHaveBeenCalledWith(pendingOffer.id);
    expect(home.activeRide.getState().offer?.status).toBe('declined');
    expect(queryOfferHeading('New ride offer')).toBeNull();
    expect(queryOfferHeading('Ride no longer available')).toBeNull();
  });

  test('announces the successful end of an offer once when its card disappears on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockClear()
      .mockImplementation(() => undefined);
    const home = setupOffer();
    home.accept.mockImplementationOnce(async () => {
      home.activeRide.getState().applyRide(driverRide, 'driver');
    });
    await home.render();
    await fireEvent.press(button('Accept'));

    expect(announce.mock.calls).toEqual([
      ['New ride offer'],
      ['Ride offer accepted'],
    ]);
    expect(queryOfferHeading('New ride offer')).toBeNull();
  });

  test('applies the validated 409 offer and shows its server status', async () => {
    const home = setupOffer();
    const expired = { ...pendingOffer, status: 'expired' };
    home.accept.mockRejectedValueOnce(new ApiError(409, { offer: expired }));
    await home.render();
    await fireEvent.press(button('Accept'));

    expect(home.activeRide.getState().offer).toEqual(expired);
    expect(offerHeading('Offer expired')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  test('shows unavailable when a 409 returns the same pending offer', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const home = setupOffer();
    home.accept.mockRejectedValueOnce(
      new ApiError(409, { offer: pendingOffer }),
    );
    await home.render();
    await fireEvent.press(button('Accept'));

    expect(offerHeading('Ride no longer available')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-view')).toBeNull();
    expect(screen.queryByLabelText('Pickup location map')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  test('keeps a newer offer when an older request returns a 409', async () => {
    const home = setupOffer();
    let reject!: (cause: ApiError) => void;
    home.accept.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    await home.render();
    await fireEvent.press(button('Accept'));
    const next = {
      ...pendingOffer,
      id: '00000000-0000-4000-8000-000000000003',
    };
    await act(() => {
      home.activeRide.getState().applyOffer(next);
      home.activeRide.getState().applyOffer({ ...next, status: 'cancelled' });
    });
    await act(() =>
      reject(
        new ApiError(409, {
          offer: { ...pendingOffer, status: 'expired' },
        }),
      ),
    );

    expect(home.activeRide.getState().offer?.id).toBe(next.id);
    expect(offerHeading('Ride no longer available')).toBeOnTheScreen();
  });

  test('shows unavailable after 404 and dismisses only the current offer', async () => {
    const home = setupOffer();
    home.decline.mockRejectedValueOnce(new ApiError(404, {}));
    await home.render();
    await fireEvent.press(button('Decline'));

    expect(offerHeading('Ride no longer available')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Accept|Decline/ })).toBeNull();
    await fireEvent.press(button('Dismiss'));
    expect(queryOfferHeading('Ride no longer available')).toBeNull();
    await act(() =>
      home.activeRide.getState().applyOffer({
        ...pendingOffer,
        id: '00000000-0000-4000-8000-000000000003',
      }),
    );
    expect(button('Accept')).toBeEnabled();
  });

  test.each([
    [0, 'No connection, try again'],
    [500, 'Something went wrong, try again'],
    [409, 'Something went wrong, try again'],
  ])(
    'shows a retryable inline offer error for status %i',
    async (status, message) => {
      const home = setupOffer();
      home.accept.mockRejectedValueOnce(
        new ApiError(status, { offer: { status: 'expired' } }),
      );
      await home.render();
      await fireEvent.press(button('Accept'));

      expect(screen.getByText(message).props.accessibilityLiveRegion).toBe(
        'polite',
      );
      expect(home.activeRide.getState().offer).toEqual(pendingOffer);
      expect(button('Accept')).toBeEnabled();
      expect(button('Decline')).toBeEnabled();
    },
  );

  test('ignores rapid taps and marks only the running offer action busy', async () => {
    const home = setupOffer();
    let finish!: () => void;
    home.decline.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    await home.render();
    const accept = button('Accept');
    const decline = button('Decline');
    await act(async () => {
      await fireEvent.press(decline);
      expect(accept).toBeEnabled();
      await fireEvent.press(accept);
      await fireEvent.press(decline);
    });

    expect(home.decline).toHaveBeenCalledTimes(1);
    expect(home.accept).not.toHaveBeenCalled();
    expect(button('Accept')).toBeDisabled();
    expect(button('Accept')).not.toBeBusy();
    expect(button('Decline')).toBeDisabled();
    expect(button('Decline')).toBeBusy();
    await act(() => {
      home.activeRide
        .getState()
        .applyOffer({ ...pendingOffer, status: 'declined' });
      finish();
    });
  });

  test('disables both offer actions while reconnecting and restores them on reconnect', async () => {
    const home = setupOffer();
    home.connection.getState().setConnected(false);
    await home.render();

    expect(screen.queryByText('Reconnecting…')).toBeNull();
    expect(button('Accept')).toBeDisabled();
    expect(button('Decline')).toBeDisabled();
    await fireEvent.press(button('Accept'));
    await fireEvent.press(button('Decline'));
    expect(home.accept).not.toHaveBeenCalled();
    expect(home.decline).not.toHaveBeenCalled();
    await act(() => home.connection.getState().setConnected(true));
    expect(button('Accept')).toBeEnabled();
    expect(button('Decline')).toBeEnabled();
  });

  test('ignores a tap on the old offer card when the socket disconnects', async () => {
    const home = setupOffer();
    let tap: Promise<unknown> | undefined;
    // Deliver the queued tap after the store changes, before Home observes it.
    const unsubscribe = home.connection.subscribe(() => {
      const accept = button('Accept');
      expect(accept).toBeEnabled();
      tap = fireEvent.press(accept);
    });

    try {
      await home.render();
      await act(async () => {
        home.connection.getState().setConnected(false);
        expect(tap).toBeDefined();
        await tap;
      });

      expect(home.accept).not.toHaveBeenCalled();
      expect(button('Accept')).toBeDisabled();
    } finally {
      unsubscribe();
    }
  });

  test.each<[string, (home: ReturnType<typeof setupOffer>) => void]>([
    [
      'the driver is suspended',
      ({ driverMode }) => driverMode.setState({ verification: 'suspended' }),
    ],
    [
      'a replacement offer arrives',
      ({ activeRide }) =>
        activeRide.getState().applyOffer({ ...pendingOffer, id: 'new-offer' }),
    ],
    [
      'the server cancels the offer',
      ({ activeRide }) =>
        activeRide
          .getState()
          .applyOffer({ ...pendingOffer, status: 'cancelled' }),
    ],
    [
      'the matching driver ride arrives',
      ({ activeRide }) => activeRide.getState().applyRide(driverRide, 'driver'),
    ],
  ])('ignores a tap on the old offer card when %s', async (_case, update) => {
    const home = setupOffer();
    await home.render();
    const accept = button('Accept');

    await act(async () => {
      update(home);
      expect(accept).toBeEnabled();
      await fireEvent.press(accept);
    });

    expect(home.accept).not.toHaveBeenCalled();
  });

  test('ignores Accept after expiry before the next countdown tick', async () => {
    jest.useFakeTimers();
    try {
      const home = setupOffer();
      let now = Date.parse(pendingOffer.expiresAt) - 1;
      await render(<DriverStatusContainer {...home.props} now={() => now} />);
      expect(screen.getByText('1 s remaining')).toBeOnTheScreen();

      now += 1;
      const accept = button('Accept');
      expect(accept).toBeEnabled();
      await fireEvent.press(accept);

      expect(home.accept).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['expired', 'Offer expired'],
    ['accepted', 'Ride no longer available'],
    ['cancelled', 'Ride no longer available'],
  ] as const)(
    'shows a dismissible %s offer in dark mode',
    async (status, title) => {
      jest.mocked(useColorScheme).mockReturnValue('dark');
      const home = setupOffer({ ...pendingOffer, status });
      await home.render();

      expect(offerHeading(title)).toHaveStyle({ color: themes.dark.text });
      expect(
        screen.queryByRole('button', { name: /Accept|Decline/ }),
      ).toBeNull();
      await fireEvent.press(button('Dismiss'));
      expect(queryOfferHeading(title)).toBeNull();
    },
  );

  test('does not show the card for an offer already declined or matched to a driver ride', async () => {
    const home = setupOffer({ ...pendingOffer, status: 'declined' });
    await home.render();
    expect(queryOfferHeading('New ride offer')).toBeNull();
    expect(queryOfferHeading('Ride no longer available')).toBeNull();

    await act(() =>
      home.activeRide
        .getState()
        .applyOffer({ ...pendingOffer, id: 'new-offer' }),
    );
    expect(offerHeading('New ride offer')).toBeOnTheScreen();
    await act(() => home.activeRide.getState().applyRide(driverRide, 'driver'));
    expect(queryOfferHeading('New ride offer')).toBeNull();
    expect(queryOfferHeading('Ride no longer available')).toBeNull();
  });
});

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
  expect(screen.queryByText('Reconnecting…')).toBeNull();
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

  expect(screen.queryByText('Reconnecting…')).toBeNull();
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

describe('driver Home ride', () => {
  function setupRide(status: Ride['status'] = 'driver_assigned') {
    const home = setup();
    home.driverMode.setState({ availability: 'on_trip' });
    home.activeRide.getState().applyRide({ ...driverRide, status }, 'driver');
    return home;
  }

  test.each(['ios', 'android'] as const)(
    'announces only later ride status changes on iOS (%s)',
    async platform => {
      jest.replaceProperty(Platform, 'OS', platform);
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockClear()
        .mockImplementation(() => undefined);
      const home = setupRide();
      home.step.mockImplementation(async (_id, action) => {
        const status = {
          arrive: 'driver_arrived',
          start: 'in_progress',
          complete: 'completed',
        } as const;
        const current = home.activeRide.getState().driver!;
        home.activeRide
          .getState()
          .applyRide(
            {
              ...current,
              version: current.version + 1,
              status: status[action],
            },
            'driver',
          );
      });
      await home.render();
      expect(
        screen.getByRole('header', { name: 'Heading to pickup' }),
      ).toBeOnTheScreen();
      expect(announce).not.toHaveBeenCalled();
      for (const name of ['Arrived at pickup', 'Start ride', 'Complete ride']) {
        await fireEvent.press(button(name));
      }
      expect(home.step.mock.calls).toEqual([
        [driverRide.id, 'arrive'],
        [driverRide.id, 'start'],
        [driverRide.id, 'complete'],
      ]);
      expect(announce.mock.calls).toEqual(
        platform === 'ios'
          ? [['Arrived at pickup'], ['Ride in progress'], ['Ride completed']]
          : [],
      );
      expect(
        screen.getByRole('header', { name: 'Ride completed' }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Fare: 12,000 ៛')).toBeOnTheScreen();
      expect(screen.getByText('Vehicle type: Remork')).toBeOnTheScreen();
      expect(screen.queryByRole('image')).toBeNull();
      await fireEvent.press(button('Dismiss'));
      expect(
        screen.queryByRole('header', { name: 'Ride completed' }),
      ).toBeNull();
      expect(home.activeRide.getState().driver?.status).toBe('completed');
    },
  );

  test('moves the driver pin and switches the target from pickup to dropoff', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(useColorScheme).mockReturnValue('dark');
    const home = setupRide();
    await home.render();
    const markers = () =>
      screen.getAllByTestId('map-marker').map(marker => marker.props.title);
    expect(markers()).toEqual(['Pickup']);
    expect(
      screen.getByRole('image', { name: 'Route to pickup location map' }),
    ).toBeOnTheScreen();
    const point = {
      lat: 11.57,
      lng: 104.98,
      recordedAt: '2026-11-21T10:00:00Z',
    };
    await act(() => home.driverMode.getState().applyPosition(point));
    expect(markers()).toEqual(['Pickup', 'Your location']);
    expect(screen.getAllByTestId('map-marker')[1].props.coordinate).toEqual({
      latitude: point.lat,
      longitude: point.lng,
    });
    expect(screen.getByTestId('map-view').props.region.latitude).toBeCloseTo(
      (point.lat + driverRide.pickup.lat) / 2,
    );
    const nextPoint = {
      ...point,
      lng: 104.95,
      recordedAt: '2026-11-21T10:00:04Z',
    };
    await act(() => home.driverMode.getState().applyPosition(nextPoint));
    expect(
      screen.getAllByTestId('map-marker')[1].props.coordinate.longitude,
    ).toBe(nextPoint.lng);
    await act(() =>
      home.activeRide
        .getState()
        .applyRide(
          { ...driverRide, status: 'in_progress', version: 3 },
          'driver',
        ),
    );
    expect(markers()).toEqual(['Dropoff', 'Your location']);
    expect(
      screen.getByRole('image', { name: 'Route to dropoff location map' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel ride' })).toBeNull();
  });

  test('queues one offline step, blocks duplicate taps, and reads the existing queue on remount', async () => {
    const home = setupRide();
    home.connection.getState().setConnected(false);
    let finish!: () => void;
    home.step.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const { unmount } = await home.render();
    const arrive = button('Arrived at pickup');
    expect(arrive).toBeEnabled();
    await act(async () => {
      await fireEvent.press(arrive);
      expect(arrive).toBeEnabled();
      await fireEvent.press(arrive);
    });
    expect(home.step).toHaveBeenCalledTimes(1);
    expect(button('Arrived at pickup')).toBeBusy();
    home.pendingSteps.mockReturnValue([
      { rideId: driverRide.id, action: 'arrive', key: 'queued' },
    ]);
    await act(() => finish());
    expect(
      screen.getByText('Saved offline. Will send when connected.'),
    ).toBeOnTheScreen();
    await act(() => home.connection.getState().setConnected(true));
    expect(button('Arrived at pickup')).toBeDisabled();
    expect(button('Cancel ride')).toBeDisabled();
    await fireEvent.press(button('Arrived at pickup'));
    expect(home.step).toHaveBeenCalledTimes(1);
    await unmount();
    await home.render();
    expect(button('Arrived at pickup')).toBeDisabled();
  });

  test('ignores a stale arrival press after the arrival is queued', async () => {
    const home = setupRide();
    await home.render();
    const arrive = button('Arrived at pickup');

    home.pendingSteps.mockReturnValue([
      { rideId: driverRide.id, action: 'arrive', key: 'queued' },
    ]);
    expect(arrive).toBeEnabled();
    await fireEvent.press(arrive);

    expect(home.step).not.toHaveBeenCalled();
  });

  test('unblocks the ride when reconnect drains a refused step without a new ride status', async () => {
    const home = setupRide();
    home.pendingSteps.mockReturnValue([
      { rideId: driverRide.id, action: 'arrive', key: 'queued' },
    ]);
    await home.render();
    expect(button('Arrived at pickup')).toBeDisabled();
    expect(button('Cancel ride')).toBeDisabled();

    await act(() => {
      home.pendingSteps.mockReturnValue([]);
      home.subscribePendingSteps.mock.calls[0][0]();
    });
    expect(button('Arrived at pickup')).toBeEnabled();
    expect(button('Cancel ride')).toBeEnabled();
    expect(
      screen.queryByText('Saved offline. Will send when connected.'),
    ).toBeNull();
  });

  test.each([
    [undefined, 'Something went wrong, try again'],
    [new ApiError(0, null), 'No connection, try again'],
  ] as const)(
    'allows a step retry after an inline error (%p)',
    async (error, message) => {
      const home = setupRide();
      if (error) home.step.mockRejectedValueOnce(error);
      await home.render();
      await fireEvent.press(button('Arrived at pickup'));
      expect(screen.getByText(message).props.accessibilityLiveRegion).toBe(
        'polite',
      );
      expect(button('Arrived at pickup')).toBeEnabled();
      await act(() =>
        home.activeRide
          .getState()
          .applyRide(
            { ...driverRide, status: 'driver_arrived', version: 2 },
            'driver',
          ),
      );
      expect(screen.queryByText(message)).toBeNull();
    },
  );

  test('lets a suspended driver continue or cancel their active ride and hides unrelated offers', async () => {
    const home = setupRide();
    home.activeRide.getState().applyOffer({ ...pendingOffer, rideId: 'other' });
    await home.render(() => offerStart);
    expect(screen.getByText('On a trip')).toBeOnTheScreen();
    expect(queryOfferHeading('New ride offer')).toBeNull();
    await act(() => home.driverMode.setState({ verification: 'suspended' }));
    await fireEvent.press(button('Arrived at pickup'));
    expect(home.step).toHaveBeenCalledWith(driverRide.id, 'arrive');
    home.cancel.mockImplementationOnce(async () => {
      home.activeRide
        .getState()
        .applyRide(
          { ...driverRide, status: 'cancelled', version: 2 },
          'driver',
        );
    });
    await fireEvent.press(button('Cancel ride'));
    expect(button('Confirm cancellation')).toBeDisabled();
    const reason = () => screen.getByRole('radio', { name: 'Vehicle problem' });
    await fireEvent.press(reason());
    expect(reason()).toBeChecked();
    await fireEvent.press(button('Keep ride'));
    await fireEvent.press(button('Cancel ride'));
    expect(reason()).not.toBeChecked();
    await fireEvent.press(reason());
    await fireEvent.press(button('Confirm cancellation'));
    expect(home.cancel).toHaveBeenCalledWith(driverRide.id, 'vehicle_problem');
    expect(
      screen.getByRole('header', { name: 'Ride cancelled' }),
    ).toBeOnTheScreen();
  });

  test('ignores a stale cancellation confirmation after disconnecting', async () => {
    const home = setupRide();
    await home.render();
    await fireEvent.press(button('Cancel ride'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Vehicle problem' }));
    const confirm = button('Confirm cancellation');

    await act(async () => {
      home.connection.getState().setConnected(false);
      expect(confirm).toBeEnabled();
      await fireEvent.press(confirm);
    });

    expect(home.cancel).not.toHaveBeenCalled();
    expect(button('Confirm cancellation')).toBeDisabled();
  });

  test('ignores a stale cancellation confirmation after a step is queued', async () => {
    const home = setupRide();
    await home.render();
    await fireEvent.press(button('Cancel ride'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Vehicle problem' }));
    const confirm = button('Confirm cancellation');

    home.pendingSteps.mockReturnValue([
      { rideId: driverRide.id, action: 'arrive', key: 'queued' },
    ]);
    expect(confirm).toBeEnabled();
    await fireEvent.press(confirm);

    expect(home.cancel).not.toHaveBeenCalled();
  });

  test('blocks offline cancellation and duplicate confirmations, then applies a 409 snapshot', async () => {
    const home = setupRide('driver_arrived');
    home.connection.getState().setConnected(false);
    let reject!: (cause: unknown) => void;
    home.cancel.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    await home.render();
    expect(button('Cancel ride')).toBeDisabled();
    await act(() => home.connection.getState().setConnected(true));
    await fireEvent.press(button('Cancel ride'));
    await fireEvent.press(
      screen.getByRole('radio', { name: 'Rider unreachable' }),
    );
    await act(() => home.connection.getState().setConnected(false));
    expect(button('Confirm cancellation')).toBeDisabled();
    await act(() => home.connection.getState().setConnected(true));
    const confirm = button('Confirm cancellation');
    await act(async () => {
      await fireEvent.press(confirm);
      expect(confirm).toBeEnabled();
      await fireEvent.press(confirm);
    });
    expect(home.cancel).toHaveBeenCalledTimes(1);
    expect(home.cancel).toHaveBeenCalledWith(
      driverRide.id,
      'rider_unreachable',
    );
    expect(button('Confirm cancellation')).toBeBusy();
    expect(button('Start ride')).toBeDisabled();
    const updated = { ...driverRide, status: 'in_progress', version: 3 };
    await act(() => reject(new ApiError(409, { ride: updated })));
    expect(home.activeRide.getState().driver).toEqual(updated);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(button('Complete ride')).toBeEnabled();
  });

  test('shows inline cancel failure and clears selection when the ride status changes', async () => {
    const home = setupRide();
    home.cancel.mockRejectedValueOnce(new ApiError(404, null));
    await home.render();
    await fireEvent.press(button('Cancel ride'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Changed mind' }));
    await fireEvent.press(button('Confirm cancellation'));
    expect(
      screen.getByText('Ride no longer available').props
        .accessibilityLiveRegion,
    ).toBe('polite');
    await act(() =>
      home.activeRide
        .getState()
        .applyRide(
          { ...driverRide, status: 'driver_arrived', version: 2 },
          'driver',
        ),
    );
    expect(screen.queryByText('Ride no longer available')).toBeNull();
    expect(button('Cancel ride')).toBeEnabled();
    await fireEvent.press(button('Cancel ride'));
    expect(
      screen.getByRole('radio', { name: 'Changed mind' }),
    ).not.toBeChecked();
  });
});
