import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import { mapPinBorderWidth, outlineWidth, themes, touch } from '@theme';
import { AndroidMapsContext } from '../../components/AppMap';
import { InteractionContext } from '../../hooks/use-interaction';
import { LanguageContext } from '../../i18n';
import RiderBookingScreen, {
  type RiderBookingForm,
} from './RiderBookingScreen';
import { PHNOM_PENH_PRESETS } from './rider-booking';

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

const pickup = PHNOM_PENH_PRESETS[0].point;
const dropoff = PHNOM_PENH_PRESETS[1].point;
const fare = { amountMinor: 5000, currency: 'KHR' } as const;
const trip = {
  id: 'ride-1',
  variant: 'active',
  pickup,
  dropoff,
  fare,
  vehicleType: 'moto',
  onOpenMap: jest.fn(),
} as const;

const quote = {
  quote: {
    id: 'quote-1',
    distanceM: 1850,
    fare,
    vehicleType: 'remork' as const,
    expiresAt: '',
  },
  seconds: 18,
  expired: false,
};

function form(overrides: Partial<RiderBookingForm> = {}): RiderBookingForm {
  return {
    pickup,
    pickupSource: 'preset',
    dropoff: null,
    target: 'dropoff',
    vehicleType: 'moto',
    cameraKey: 0,
    pinRevision: 0,
    busy: false,
    samePoint: false,
    locating: false,
    quoting: false,
    booking: false,
    canQuote: false,
    canBook: false,
    onSelectTarget: jest.fn(),
    onSelectPreset: jest.fn(),
    onSelectVehicle: jest.fn(),
    onUseCurrentLocation: jest.fn(),
    onMapPress: jest.fn(),
    onDragPickup: jest.fn(),
    onDragDropoff: jest.fn(),
    onRequestQuote: jest.fn(),
    onBook: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.mocked(useColorScheme).mockReturnValue('light');
});
afterEach(() => jest.restoreAllMocks());

const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: string) => screen.getByRole('radio', { name });

test.each(['light', 'dark'] as const)(
  'renders the initial rider controls and theme in %s mode',
  async scheme => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const booking = form();
    const onDebug = jest.fn();
    await render(
      <RiderBookingScreen
        booking={booking}
        khrPerUsd={null}
        onDebug={onDebug}
      />,
    );

    expect(
      screen.getByRole('header', { name: 'Rider home' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('map-view').props.userInterfaceStyle).toBe(
      scheme,
    );
    expect(screen.getByText('Choose a dropoff')).toBeOnTheScreen();
    expect(radio('Dropoff')).toBeChecked();
    expect(radio('Motorbike')).toBeChecked();
    for (const name of ['Dropoff', 'Motorbike']) {
      expect(radio(name)).toHaveStyle({ borderWidth: mapPinBorderWidth });
      const checkmark = within(radio(name)).getByText('✓', {
        includeHiddenElements: true,
      });
      expect(checkmark).toHaveProp('accessible', false);
      expect(checkmark).toHaveProp('importantForAccessibility', 'no');
    }
    for (const name of ['Pickup', 'Remork', 'Bajaj']) {
      expect(radio(name)).toHaveStyle({ borderWidth: outlineWidth });
      expect(
        within(radio(name)).queryByText('✓', { includeHiddenElements: true }),
      ).toBeNull();
    }
    expect(radio('Pickup')).toHaveStyle({
      minHeight: touch.min,
      minWidth: touch.min,
      backgroundColor: themes[scheme].surface,
    });
    expect(button('Get fare quote')).toBeDisabled();

    await fireEvent.press(radio('Pickup'));
    await fireEvent.press(button('Central Market'));
    await fireEvent.press(button('Russian Market'));
    await fireEvent.press(button('Riverside'));
    await fireEvent.press(button('Independence Monument'));
    await fireEvent.press(radio('Remork'));
    await fireEvent.press(radio('Bajaj'));
    await fireEvent.press(button('Use current location'));
    await fireEvent.press(button('Debug'));
    expect(booking.onSelectTarget).toHaveBeenCalledWith('pickup');
    expect(jest.mocked(booking.onSelectPreset).mock.calls).toEqual([
      ['central_market'],
      ['russian_market'],
      ['riverside'],
      ['independence'],
    ]);
    expect(jest.mocked(booking.onSelectVehicle).mock.calls).toEqual([
      ['remork'],
      ['bajaj'],
    ]);
    expect(booking.onUseCurrentLocation).toHaveBeenCalledTimes(1);
    expect(onDebug).toHaveBeenCalledTimes(1);
  },
);

test.each(['locating', 'quoting', 'booking'] as const)(
  'shows the busy control while %s and locks selection only for booking',
  async action => {
    const locked = action === 'booking';
    const booking = form({
      dropoff,
      quote,
      [action]: true,
      busy: locked,
      canQuote: action === 'locating',
      canBook: action === 'locating',
    });
    await render(<RiderBookingScreen booking={booking} khrPerUsd={null} />);
    const active = button(
      {
        locating: 'Use current location',
        quoting: 'Get new quote',
        booking: 'Book ride',
      }[action],
    );
    expect(active).toBeBusy();
    expect(active).toBeDisabled();
    await fireEvent.press(active);
    await fireEvent.press(button('Book ride'));
    await fireEvent.press(button('Get new quote'));
    expect(booking.onUseCurrentLocation).not.toHaveBeenCalled();
    expect(booking.onRequestQuote).toHaveBeenCalledTimes(
      action === 'locating' ? 1 : 0,
    );
    expect(booking.onBook).toHaveBeenCalledTimes(action === 'locating' ? 1 : 0);
    if (locked) {
      expect(radio('Pickup')).toBeDisabled();
      expect(radio('Bajaj')).toBeDisabled();
      expect(button('Central Market')).toBeDisabled();
      await fireEvent.press(radio('Pickup'));
      await fireEvent.press(radio('Bajaj'));
      await fireEvent.press(button('Central Market'));
      expect(booking.onSelectTarget).not.toHaveBeenCalled();
      expect(booking.onSelectVehicle).not.toHaveBeenCalled();
      expect(booking.onSelectPreset).not.toHaveBeenCalled();
      expect(screen.getByTestId('map-view').props.onPress).toBeUndefined();
      expect(
        screen.getAllByTestId('map-marker').every(pin => !pin.props.draggable),
      ).toBe(true);
    } else {
      expect(radio('Pickup')).toBeEnabled();
      expect(radio('Bajaj')).toBeEnabled();
      expect(button('Central Market')).toBeEnabled();
      expect(screen.getByTestId('map-view').props.onPress).toBeDefined();
    }
  },
);

test('honors the app interaction gate for radios, presets, and map gestures', async () => {
  const booking = form({ dropoff });
  await render(
    <InteractionContext.Provider value={() => false}>
      <RiderBookingScreen booking={booking} khrPerUsd={null} />
    </InteractionContext.Provider>,
  );
  const event = {
    nativeEvent: { coordinate: { latitude: 11.57, longitude: 104.92 } },
  };
  await fireEvent.press(radio('Pickup'));
  await fireEvent.press(radio('Bajaj'));
  await fireEvent.press(button('Central Market'));
  await fireEvent.press(screen.getByTestId('map-view'), event);
  const [pickupPin, dropoffPin] = screen.getAllByTestId('map-marker');
  await fireEvent(pickupPin, 'dragEnd', event);
  await fireEvent(dropoffPin, 'dragEnd', event);
  for (const handler of [
    booking.onSelectTarget,
    booking.onSelectVehicle,
    booking.onSelectPreset,
    booking.onMapPress,
    booking.onDragPickup,
    booking.onDragDropoff,
  ])
    expect(handler).not.toHaveBeenCalled();
});

test('shows Khmer preset and quote text and approximate USD with the Android map fallback', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await render(
    <LanguageContext.Provider value="km">
      <RiderBookingScreen booking={form({ dropoff, quote })} khrPerUsd={4000} />
    </LanguageContext.Provider>,
  );

  expect(
    screen.getByRole('header', { name: 'ទំព័រដើមសម្រាប់អ្នកដំណើរ' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('image', { name: 'មិនអាចបង្ហាញផែនទីបានទេ' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      'ជ្រើសរើសកន្លែងឡើង ឬកន្លែងចុះ រួចជ្រើសរើសទីតាំងខាងក្រោម ឬប្រើទីតាំងបច្ចុប្បន្នរបស់អ្នក។',
    ),
  ).toBeOnTheScreen();
  expect(button('ផ្សារធំថ្មី')).toBeOnTheScreen();
  expect(button('កក់ការធ្វើដំណើរ')).toBeOnTheScreen();
  expect(screen.getByText('5,000 ៛')).toBeOnTheScreen();
  expect(screen.getByText('≈ $1.25')).toBeOnTheScreen();
});

test('adapts the English map hint and label to Android Maps configuration', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const booking = <RiderBookingScreen booking={form()} khrPerUsd={null} />;
  const { rerender } = await render(booking);
  const interactiveHint =
    'Choose pickup or dropoff, then pick a place below. On the map, tap a location or drag a pin.';
  const fallbackHint =
    'Choose pickup or dropoff, then pick a place below or use your current location.';
  expect(
    screen.getByRole('image', { name: 'Map preview unavailable' }),
  ).toBeOnTheScreen();
  expect(screen.getByText(fallbackHint)).toBeOnTheScreen();
  expect(screen.queryByText(interactiveHint)).toBeNull();

  await rerender(
    <AndroidMapsContext.Provider value>{booking}</AndroidMapsContext.Provider>,
  );
  expect(screen.getByLabelText('Pickup and dropoff selection map')).toHaveProp(
    'testID',
    'map-view',
  );
  expect(screen.getByText(interactiveHint)).toBeOnTheScreen();
  expect(screen.queryByText(fallbackHint)).toBeNull();

  const active = (
    <RiderBookingScreen
      activeRide={{ ...trip, status: 'searching' }}
      khrPerUsd={null}
    />
  );
  await rerender(active);
  expect(
    screen.getByRole('image', { name: 'Map preview unavailable' }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Open live ride map' }),
  ).toBeNull();
  expect(screen.queryByText('Tap map to view full screen')).toBeNull();

  await rerender(
    <AndroidMapsContext.Provider value>{active}</AndroidMapsContext.Provider>,
  );
  expect(button('Open live ride map')).toBeOnTheScreen();
  await fireEvent.press(button('Open live ride map'));
  expect(trip.onOpenMap).toHaveBeenCalledTimes(1);
});

test('keeps booking enabled and omits the countdown at zero seconds', async () => {
  await render(
    <RiderBookingScreen
      booking={form({
        dropoff,
        canBook: true,
        quote: { ...quote, seconds: 0 },
      })}
      khrPerUsd={null}
    />,
  );
  expect(screen.queryByText(/Quote expires in/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(button('Book ride')).toBeEnabled();
});

test('announces changed active-ride status once on iOS', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const { rerender } = await render(
    <RiderBookingScreen
      activeRide={{ ...trip, status: 'searching' }}
      khrPerUsd={null}
    />,
  );
  expect(announce).not.toHaveBeenCalled();
  await rerender(
    <RiderBookingScreen
      activeRide={{ ...trip, status: 'driver_assigned' }}
      khrPerUsd={null}
    />,
  );
  await rerender(
    <RiderBookingScreen
      activeRide={{ ...trip, status: 'driver_assigned' }}
      khrPerUsd={4000}
    />,
  );
  await rerender(
    <RiderBookingScreen
      activeRide={{ ...trip, id: 'different-ride', status: 'searching' }}
      khrPerUsd={null}
    />,
  );
  expect(announce.mock.calls).toEqual([['Driver assigned']]);
});

test('announces changed inline errors and lets the expiry banner announce itself once on iOS', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const { rerender } = await render(
    <RiderBookingScreen booking={form()} khrPerUsd={null} />,
  );
  const errors = form({
    dropoff,
    quote,
    locationError: 'riderBooking.error.locationUnavailable',
    samePoint: true,
    quoteError: 'riderBooking.error.quoteFailed',
    bookError: 'riderBooking.error.bookFailed',
  });
  await rerender(<RiderBookingScreen booking={errors} khrPerUsd={null} />);
  await rerender(
    <RiderBookingScreen booking={{ ...errors }} khrPerUsd={4000} />,
  );
  expect(announce.mock.calls).toEqual([
    ['Could not get your location. Try again or choose a place.'],
    ['Pickup and dropoff must be different.'],
    ['Could not get a fare quote. Try again.'],
    ['Could not book your ride. Try again.'],
  ]);
  announce.mockClear();
  const expired = form({
    dropoff,
    quote: { ...quote, expired: true },
    bookError: 'riderBooking.error.quoteExpired',
  });
  await rerender(<RiderBookingScreen booking={expired} khrPerUsd={null} />);
  await rerender(
    <RiderBookingScreen booking={{ ...expired }} khrPerUsd={4000} />,
  );
  expect(announce.mock.calls).toEqual([
    ['This quote has expired. Get a new quote.'],
  ]);
});

test('announces an offscreen cancellation error once when Rider Home regains focus', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const activeRide = {
    ...trip,
    status: 'driver_assigned',
    cancel: {
      open: true,
      selected: 'other',
      disabled: false,
      loading: false,
      error: 'riderRide.error.cancelFailed',
      onOpen: jest.fn(),
      onSelect: jest.fn(),
      onConfirm: jest.fn(),
      onKeep: jest.fn(),
    },
  } as const;
  const view = (focused: boolean) => (
    <RiderBookingScreen
      activeRide={activeRide}
      khrPerUsd={null}
      focused={focused}
    />
  );
  const { rerender } = await render(
    <RiderBookingScreen
      activeRide={{
        ...activeRide,
        cancel: { ...activeRide.cancel, error: undefined },
      }}
      khrPerUsd={null}
      focused={false}
    />,
  );
  await rerender(view(false));
  const error = 'Could not cancel your ride. Try again.';
  expect(screen.getByText(error)).toBeOnTheScreen();
  expect(announce).not.toHaveBeenCalled();
  await rerender(view(true));
  await rerender(view(false));
  await rerender(view(true));
  expect(announce.mock.calls).toEqual([[error]]);
});

test('shows the active ride with both pins, fare, and status in place of booking', async () => {
  const onDebug = jest.fn();
  await render(
    <RiderBookingScreen
      activeRide={{ ...trip, status: 'driver_arrived', vehicleType: 'remork' }}
      khrPerUsd={4000}
      onDebug={onDebug}
    />,
  );

  expect(screen.getByRole('header', { name: 'Rider home' })).toBeOnTheScreen();
  expect(screen.getByText('Driver arrived')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  expect(button('Open live ride map')).toBeOnTheScreen();
  expect(
    screen.getByRole('progressbar', {
      name: 'Ride progress: step 3 of 5, Arrived',
    }),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('map-view').props.region).toMatchObject({
    latitude: (pickup.lat + dropoff.lat) / 2,
    longitude: (pickup.lng + dropoff.lng) / 2,
  });
  expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
  expect(screen.getByText('5,000 ៛')).toBeOnTheScreen();
  expect(screen.getByText('≈ $1.25')).toBeOnTheScreen();
  expect(screen.getByText('Vehicle type: Remork')).toBeOnTheScreen();
  expect(screen.getByText('Independence Monument')).toBeOnTheScreen();
  expect(screen.getByText('Central Market')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Get fare quote' })).toBeNull();
  await fireEvent.press(button('Debug'));
  expect(onDebug).toHaveBeenCalledTimes(1);
});

test('localizes active status, stages, map, and route summary in dark mode and Khmer', async () => {
  jest.mocked(useColorScheme).mockReturnValue('dark');
  await render(
    <LanguageContext.Provider value="km">
      <RiderBookingScreen
        activeRide={{
          ...trip,
          status: 'driver_assigned',
          driverStale: true,
          dropoff: { lat: 11.55, lng: 104.915 },
        }}
        khrPerUsd={null}
      />
    </LanguageContext.Provider>,
  );
  expect(screen.getByRole('header', { name: 'បានរកឃើញអ្នកបើកបរ' })).toHaveStyle(
    { color: themes.dark.text },
  );
  expect(screen.getByRole('progressbar', { name: /2.*5/ })).toBeOnTheScreen();
  expect(screen.getByText('វិមានឯករាជ្យ')).toBeOnTheScreen();
  expect(screen.getByText('11.5500, 104.9150')).toBeOnTheScreen();
  expect(
    screen.getByText(/ទីតាំងអ្នកបើកបរមិនបានធ្វើបច្ចុប្បន្នភាព/),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('map-view')).toHaveProp(
    'userInterfaceStyle',
    'dark',
  );
});
