import type { Point, Quote, Ride } from '@lern/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import MapView from 'react-native-maps';
import { ApiError } from '../../services/api.service';
import type { CurrentLocationResult } from '../../services/location.service';
import { createActiveRideStore } from '../../stores/active-ride.store';
import { createAppConfigStore } from '../../stores/app-config.store';
import { createConnectionStore } from '../../stores/connection.store';
import RiderBookingContainer, {
  type RiderBookingActions,
} from './RiderBookingContainer';
import { PHNOM_PENH_PRESETS } from './rider-booking';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => false,
}));

const { animateToRegion } = MapView as unknown as {
  animateToRegion: jest.Mock;
};
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  animateToRegion.mockClear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const [independence, central, russian, riverside] = PHNOM_PENH_PRESETS;
const gpsPoint = { lat: 11.57, lng: 104.93 };
const outside = { lat: 13, lng: 109 };
const start = Date.UTC(2026, 10, 26);
const exampleQuote: Quote = {
  id: 'quote-1',
  expiresAt: new Date(start + 3000).toISOString(),
  fare: { amountMinor: 5000, currency: 'KHR' },
  vehicleType: 'moto',
  distanceM: 1850,
};
const ride: Ride = {
  id: 'ride-1',
  version: 1,
  status: 'searching',
  pickup: independence.point,
  dropoff: central.point,
  vehicleType: 'moto',
  fare: exampleQuote.fare,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function setup(now = () => start) {
  const activeRide = createActiveRideStore();
  const appConfig = createAppConfigStore();
  const connection = createConnectionStore();
  connection.getState().setConnected(true);
  const getCurrentLocation = jest.fn<Promise<CurrentLocationResult>, []>(
    async () => ({ status: 'ok', point: gpsPoint }),
  );
  const quote = jest.fn<
    ReturnType<RiderBookingActions['quote']>,
    Parameters<RiderBookingActions['quote']>
  >(async () => exampleQuote);
  const book = jest.fn<Promise<void>, [string, string?]>(async () => {
    activeRide.getState().applyRide(ride, 'rider');
  });
  const view = await render(
    <RiderBookingContainer
      {...{
        activeRide,
        appConfig,
        connection,
        quote,
        book,
        getCurrentLocation,
        now,
      }}
    />,
  );
  return {
    activeRide,
    appConfig,
    connection,
    quote,
    book,
    getCurrentLocation,
    view,
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: string) => screen.getByRole('radio', { name });
const press = (name: string) => fireEvent.press(button(name));
const requestQuote = () => press('Get fare quote');
const gps = () => press('Use current location');
const bookRide = () => press('Book ride');
const coordinates = ({ lat, lng }: Point) => ({
  latitude: lat,
  longitude: lng,
});
const mapEvent = (point: Point) => ({
  nativeEvent: { coordinate: coordinates(point) },
});
const mapPress = (point: Point) =>
  fireEvent.press(screen.getByTestId('map-view'), mapEvent(point));
const marker = (title: string) =>
  screen.getAllByTestId('map-marker').find(pin => pin.props.title === title)!;
const drag = (title: string, point: Point) =>
  fireEvent(marker(title), 'dragEnd', mapEvent(point));
const outsideMessage = 'Choose a location within Cambodia.';

async function selectDropoffAndQuote() {
  await press('Central Market');
  await requestQuote();
}

test('uses foreground GPS for pickup only, guards a double tap, and keeps the selected dropoff', async () => {
  const { quote, getCurrentLocation } = await setup();
  expect(animateToRegion).not.toHaveBeenCalled();
  const fix = deferred<CurrentLocationResult>();
  getCurrentLocation.mockReturnValueOnce(fix.promise);
  await press('Central Market');
  expect(animateToRegion).toHaveBeenCalledTimes(1);
  await act(async () => {
    await gps();
    await gps();
  });
  expect(getCurrentLocation).toHaveBeenCalledTimes(1);
  expect(button('Use current location')).toBeBusy();
  expect(button('Get fare quote')).toBeEnabled();
  await requestQuote();
  expect(quote).toHaveBeenLastCalledWith({
    pickup: independence.point,
    dropoff: central.point,
    vehicleType: 'moto',
  });
  await act(() => fix.resolve({ status: 'ok', point: gpsPoint }));

  expect(screen.getByText('Current location')).toBeOnTheScreen();
  expect(radio('Dropoff')).toBeChecked();
  expect(marker('Pickup').props.coordinate).toEqual(coordinates(gpsPoint));
  expect(animateToRegion).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
  await requestQuote();
  expect(quote).toHaveBeenLastCalledWith({
    pickup: gpsPoint,
    dropoff: central.point,
    vehicleType: 'moto',
  });
});

test.each(['preset', 'map', 'drag'])(
  'allows manual selection during GPS and abandons the fix after a %s pickup',
  async method => {
    const { getCurrentLocation } = await setup();
    const fix = deferred<CurrentLocationResult>();
    getCurrentLocation.mockReturnValueOnce(fix.promise);
    await gps();
    expect(button('Central Market')).toBeEnabled();
    await press('Central Market');
    expect(marker('Dropoff').props.coordinate).toEqual(
      coordinates(central.point),
    );
    expect(button('Use current location')).toBeBusy();
    await fireEvent.press(radio('Pickup'));
    if (method === 'preset') await press('Russian Market');
    else if (method === 'map') await mapPress(russian.point);
    else await drag('Pickup', russian.point);

    expect(button('Use current location')).toBeEnabled();
    expect(button('Use current location')).not.toBeBusy();
    await act(() => fix.resolve({ status: 'ok', point: gpsPoint }));
    expect(marker('Pickup').props.coordinate).toEqual(
      coordinates(russian.point),
    );
  },
);

test.each([
  [
    { status: 'denied' },
    'Location permission was denied. Choose a place or use the map.',
  ],
  [
    { status: 'unavailable' },
    'Could not get your location. Try again or choose a place.',
  ],
  [{ status: 'ok', point: outside }, outsideMessage],
] as const)(
  'keeps pickup and shows inline feedback for GPS %j',
  async (result, message) => {
    const { getCurrentLocation } = await setup();
    getCurrentLocation.mockResolvedValueOnce(result);

    await gps();

    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(marker('Pickup').props.coordinate).toEqual(
      coordinates(independence.point),
    );
    expect(button('Use current location')).toBeEnabled();
    await press('Central Market');
    expect(screen.queryByText(message)).toBeNull();
  },
);

test('handles an unexpected GPS rejection and re-enables the control', async () => {
  const { getCurrentLocation } = await setup();
  getCurrentLocation.mockRejectedValueOnce(new Error('Native GPS failed'));
  await gps();
  expect(
    screen.getByText(
      'Could not get your location. Try again or choose a place.',
    ),
  ).toBeOnTheScreen();
  expect(button('Use current location')).toBeEnabled();
});

test('presets, map presses, and drags change the intended endpoint and keep the previous point outside the area', async () => {
  const { quote } = await setup();
  await mapPress(outside);
  expect(screen.getByText(outsideMessage)).toBeOnTheScreen();
  expect(screen.getByText('Choose a dropoff')).toBeOnTheScreen();
  await mapPress(central.point);
  expect(animateToRegion).not.toHaveBeenCalled();
  expect(screen.queryByText(outsideMessage)).toBeNull();
  await fireEvent.press(radio('Pickup'));
  await press('Russian Market');
  expect(marker('Pickup').props.coordinate).toEqual(coordinates(russian.point));
  const draggedPickup = marker('Pickup');
  await drag('Pickup', outside);
  expect(screen.getByText(outsideMessage)).toBeOnTheScreen();
  expect(draggedPickup).not.toBeOnTheScreen();
  expect(marker('Pickup').props.coordinate).toEqual(coordinates(russian.point));
  await drag('Dropoff', outside);
  expect(marker('Dropoff').props.coordinate).toEqual(
    coordinates(central.point),
  );
  await drag('Dropoff', riverside.point);
  expect(screen.queryByText(outsideMessage)).toBeNull();
  await drag('Pickup', gpsPoint);
  expect(animateToRegion).toHaveBeenCalledTimes(1);
  expect(screen.getByText('11.5700, 104.9300')).toBeOnTheScreen();
  await fireEvent.press(radio('Bajaj'));
  await requestQuote();
  expect(quote).toHaveBeenCalledWith({
    pickup: gpsPoint,
    dropoff: riverside.point,
    vehicleType: 'bajaj',
  });
});

test('requires different endpoints and a connection before requesting a quote', async () => {
  const { quote, connection } = await setup();
  expect(button('Get fare quote')).toBeDisabled();
  await press('Independence Monument');
  expect(screen.getByText('Pickup and dropoff must be different.')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  await requestQuote();
  expect(quote).not.toHaveBeenCalled();
  await act(() => connection.getState().setConnected(false));
  await press('Central Market');
  expect(screen.queryByRole('alert')).toBeNull();
  await requestQuote();
  expect(quote).not.toHaveBeenCalled();
  await act(() => connection.getState().setConnected(true));
  expect(button('Get fare quote')).toBeEnabled();
});

test.each(['resolve', 'reject'])(
  'discards a stale quote %s after inputs change and guards duplicate quotes',
  async outcome => {
    const { quote } = await setup();
    const request = deferred<Quote>();
    quote.mockImplementationOnce(async () => {
      const value = await request.promise;
      if (outcome === 'reject') throw new ApiError(400, null);
      return value;
    });
    await press('Central Market');
    await act(async () => {
      await requestQuote();
      await requestQuote();
    });
    expect(quote).toHaveBeenCalledTimes(1);
    expect(button('Get fare quote')).toBeBusy();
    await fireEvent.press(radio('Remork'));
    await act(() => request.resolve(exampleQuote));

    expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
    expect(screen.queryByText(outsideMessage)).toBeNull();
    expect(button('Get fare quote')).toBeEnabled();
    await requestQuote();
    expect(quote).toHaveBeenLastCalledWith({
      pickup: independence.point,
      dropoff: central.point,
      vehicleType: 'remork',
    });
  },
);

test('updates the KHR approximation when config arrives, counts down, and refreshes an expired quote', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(start);
  const { quote, book, appConfig } = await setup(Date.now);
  await selectDropoffAndQuote();
  expect(screen.getByText('Distance: 1.9 km')).toBeOnTheScreen();
  expect(screen.getByText('5,000 ៛')).toBeOnTheScreen();
  expect(screen.queryByText('≈ $1.25')).toBeNull();
  expect(screen.getByText('Quote expires in 3s')).toBeOnTheScreen();
  await act(() => appConfig.getState().setKhrPerUsd(4000));
  expect(screen.getByText('≈ $1.25')).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText('Quote expires in 2s')).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(2000));
  expect(screen.queryByText(/Quote expires in/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(button('Book ride')).toBeEnabled();
  book.mockRejectedValueOnce(new ApiError(410, null));
  await bookRide();
  expect(book).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This quote has expired. Get a new quote.',
  );
  expect(button('Book ride')).toBeDisabled();
  await bookRide();
  expect(book).toHaveBeenCalledTimes(1);

  quote.mockResolvedValueOnce({
    ...exampleQuote,
    id: 'quote-2',
    expiresAt: new Date(start + 9000).toISOString(),
  });
  await press('Get new quote');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Quote expires in 6s')).toBeOnTheScreen();
  expect(button('Book ride')).toBeEnabled();
  await press('Russian Market');
  expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
});

test('books a quote returned when the device clock is fast', async () => {
  const { book } = await setup(() => start + 5 * 60_000);
  await selectDropoffAndQuote();
  expect(screen.queryByText(/Quote expires in/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(button('Book ride')).toBeEnabled();
  await bookRide();
  expect(book).toHaveBeenCalledTimes(1);
});

test('books even if the device clock reaches zero before the next timer tick', async () => {
  let now = start;
  const { book } = await setup(() => now);
  await selectDropoffAndQuote();
  now += 3000;
  await bookRide();
  expect(book).toHaveBeenCalledTimes(1);
});

test.each([
  [400, outsideMessage],
  [0, 'Connection lost. Try again when you’re connected.'],
  [500, 'Could not get a fare quote. Try again.'],
])(
  'maps quote error %i to an inline message and allows retry',
  async (status, message) => {
    const { quote } = await setup();
    quote.mockRejectedValueOnce(new ApiError(status, null));
    await selectDropoffAndQuote();

    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    await requestQuote();
    expect(screen.queryByText(message)).toBeNull();
    expect(button('Book ride')).toBeEnabled();
  },
);

test.each([410, 404])(
  'expires the quote and shows one warning when booking returns %i',
  async status => {
    const { book } = await setup();
    book.mockRejectedValueOnce(new ApiError(status, null));
    await selectDropoffAndQuote();
    await bookRide();

    expect(
      screen.getAllByText('This quote has expired. Get a new quote.'),
    ).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(button('Book ride')).toBeDisabled();
    expect(button('Get new quote')).toBeEnabled();
  },
);

test.each([
  [409, 'A ride is already active or this quote has been used.'],
  [0, 'Connection lost. Try again when you’re connected.'],
  [500, 'Could not book your ride. Try again.'],
])(
  'shows an inline error for booking status %i and leaves the quote usable',
  async (status, message) => {
    const { book, connection } = await setup();
    book.mockRejectedValueOnce(new ApiError(status, null));
    await selectDropoffAndQuote();
    await act(() => connection.getState().setConnected(false));
    await bookRide();
    expect(book).not.toHaveBeenCalled();
    await act(() => connection.getState().setConnected(true));
    await bookRide();

    expect(screen.getByText(message)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(button('Book ride')).toBeEnabled();
  },
);

test('books once and follows the active ride until booking can resume', async () => {
  const { book, activeRide, appConfig, getCurrentLocation } = await setup();
  const pending = deferred<void>();
  book.mockImplementationOnce(async () => {
    await pending.promise;
    activeRide.getState().applyRide(ride, 'rider');
  });
  await act(() => appConfig.getState().setKhrPerUsd(4000));
  await selectDropoffAndQuote();
  await act(async () => {
    await bookRide();
    await bookRide();
  });
  await gps();
  expect(getCurrentLocation).not.toHaveBeenCalled();
  expect(book).toHaveBeenCalledTimes(1);
  expect(book.mock.calls[0][0]).toBe(exampleQuote.id);
  expect(button('Book ride')).toBeBusy();

  await act(() => pending.resolve());
  expect(screen.getByText('Looking for a driver')).toBeOnTheScreen();
  expect(screen.getByText('≈ $1.25')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
  for (const [index, [status, label]] of (
    [
      ['driver_assigned', 'Driver assigned'],
      ['driver_arrived', 'Driver arrived'],
      ['in_progress', 'Ride in progress'],
    ] as const
  ).entries()) {
    await act(() =>
      activeRide
        .getState()
        .applyRide({ ...ride, version: index + 2, status }, 'rider'),
    );
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
  for (const [index, status] of (
    ['completed', 'cancelled', 'no_driver_found'] as const
  ).entries()) {
    await act(() =>
      activeRide
        .getState()
        .applyRide({ ...ride, version: index + 5, status }, 'rider'),
    );
    expect(button('Get fare quote')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
  }
});

test('reuses the booking key after a lost response and gives a new quote a fresh key', async () => {
  const { quote, book } = await setup();
  book
    .mockRejectedValueOnce(new ApiError(0, null))
    .mockRejectedValueOnce(new ApiError(500, null));
  await selectDropoffAndQuote();
  await bookRide();
  const firstKey = book.mock.calls[0]?.[1];
  expect(firstKey).toEqual(expect.any(String));
  await bookRide();
  expect(book).toHaveBeenLastCalledWith(exampleQuote.id, firstKey);

  quote.mockResolvedValueOnce({ ...exampleQuote, id: 'quote-2' });
  await press('Get new quote');
  await bookRide();
  expect(book).toHaveBeenLastCalledWith('quote-2', expect.any(String));
  expect(book.mock.calls[2][1]).not.toBe(firstKey);
});

test('books while GPS is pending and keeps the quoted pickup if booking fails', async () => {
  const { book, getCurrentLocation } = await setup();
  const fix = deferred<CurrentLocationResult>();
  const booking = deferred<void>();
  getCurrentLocation.mockReturnValueOnce(fix.promise);
  book.mockReturnValueOnce(booking.promise);
  await selectDropoffAndQuote();
  await gps();
  expect(button('Book ride')).toBeEnabled();
  await bookRide();
  expect(book).toHaveBeenCalledTimes(1);
  await act(() => fix.resolve({ status: 'ok', point: gpsPoint }));
  await act(() => booking.reject(new ApiError(500, null)));
  expect(button('Book ride')).toBeEnabled();
  expect(marker('Pickup').props.coordinate).toEqual(
    coordinates(independence.point),
  );
});

test.each(['completed', 'cancelled'] as const)(
  'clears a held quote when an external ride arrives and then becomes %s',
  async status => {
    const { activeRide } = await setup();
    await selectDropoffAndQuote();
    expect(button('Book ride')).toBeEnabled();
    await act(() => activeRide.getState().applyRide(ride));
    expect(screen.getByText('Looking for a driver')).toBeOnTheScreen();
    await act(() =>
      activeRide.getState().applyRide({ ...ride, version: 2, status }),
    );
    expect(button('Get fare quote')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
  },
);

test.each(['resolve', 'reject'])(
  'ignores a GPS request that %ss after an external ride',
  async outcome => {
    const { activeRide, getCurrentLocation } = await setup();
    const fix = deferred<CurrentLocationResult>();
    getCurrentLocation.mockReturnValueOnce(fix.promise);
    await gps();
    await act(() => activeRide.getState().applyRide(ride));
    await act(() =>
      activeRide
        .getState()
        .applyRide({ ...ride, version: 2, status: 'completed' }),
    );
    expect(button('Use current location')).toBeEnabled();
    await act(() => {
      if (outcome === 'resolve') fix.resolve({ status: 'ok', point: gpsPoint });
      else fix.reject(new Error('No fix'));
    });
    expect(marker('Pickup').props.coordinate).toEqual(
      coordinates(independence.point),
    );
    expect(screen.queryByText(/Could not get your location/)).toBeNull();
  },
);

test.each(['resolve', 'reject'])(
  'ignores a quote request that %ss after an external ride',
  async outcome => {
    const { activeRide, quote } = await setup();
    const request = deferred<Quote>();
    quote.mockReturnValueOnce(request.promise);
    await selectDropoffAndQuote();
    expect(button('Get fare quote')).toBeBusy();
    await act(() => activeRide.getState().applyRide(ride));
    await act(() =>
      activeRide
        .getState()
        .applyRide({ ...ride, version: 2, status: 'cancelled' }),
    );
    await act(() => {
      if (outcome === 'resolve') request.resolve(exampleQuote);
      else request.reject(new ApiError(500, null));
    });
    expect(screen.queryByRole('button', { name: 'Book ride' })).toBeNull();
    expect(screen.queryByText(/Could not get a fare quote/)).toBeNull();
  },
);

test.each([409, 500])(
  'ignores booking error %i after the socket delivers the ride',
  async status => {
    const { activeRide, book } = await setup();
    const pending = deferred<void>();
    book.mockReturnValueOnce(pending.promise);
    await selectDropoffAndQuote();
    await bookRide();
    await act(() => activeRide.getState().applyRide(ride));
    expect(screen.getByText('Looking for a driver')).toBeOnTheScreen();
    await act(() => pending.reject(new ApiError(status, null)));
    expect(screen.getByText('Looking for a driver')).toBeOnTheScreen();
    await act(() =>
      activeRide
        .getState()
        .applyRide({ ...ride, version: 2, status: 'completed' }),
    );
    expect(
      screen.queryByText(/A ride is already active|Could not book your ride/),
    ).toBeNull();
    await requestQuote();
    expect(button('Book ride')).toBeEnabled();
  },
);

test.each(['gps', 'quote', 'book'] as const)(
  'handles unmount during a pending %s request',
  async action => {
    const { view, getCurrentLocation, quote, book } = await setup();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let settle: () => void;
    if (action === 'gps') {
      const pending = deferred<CurrentLocationResult>();
      getCurrentLocation.mockReturnValueOnce(pending.promise);
      await gps();
      expect(button('Use current location')).toBeBusy();
      settle = () => pending.resolve({ status: 'ok', point: gpsPoint });
    } else if (action === 'quote') {
      const pending = deferred<Quote>();
      quote.mockReturnValueOnce(pending.promise);
      await selectDropoffAndQuote();
      expect(button('Get fare quote')).toBeBusy();
      settle = () => pending.resolve(exampleQuote);
    } else {
      const pending = deferred<void>();
      book.mockReturnValueOnce(pending.promise);
      await selectDropoffAndQuote();
      await bookRide();
      expect(button('Book ride')).toBeBusy();
      settle = () => pending.reject(new ApiError(500, null));
    }
    await view.unmount();
    await act(settle);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  },
);
