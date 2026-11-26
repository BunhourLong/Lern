import type { Ride } from '@lern/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import MapView from 'react-native-maps';
import { themes } from '@theme';
import { LanguageContext } from '../../i18n';
import { createActiveRideStore } from '../../stores/active-ride.store';
import RiderRideMapContainer from './RiderRideMapContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => false }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const { animateToRegion } = MapView as unknown as {
  animateToRegion: jest.Mock;
};
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.mocked(useColorScheme).mockReturnValue('light');
  animateToRegion.mockClear();
});
afterEach(() => jest.restoreAllMocks());

const ride: Ride = {
  id: 'ride-1',
  status: 'searching',
  version: 1,
  vehicleType: 'moto',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.56, lng: 104.93 },
  fare: { amountMinor: 5000, currency: 'KHR' },
};
const position = {
  lat: 11.6,
  lng: 104.9,
  rideId: ride.id,
  recordedAt: '2026-11-26T00:00:00Z',
};
const connectivity = {
  rideId: ride.id,
  stale: true,
  lastSeenAt: position.recordedAt,
};
const stale = 'Driver location hasn’t updated recently. Trying to reconnect.';
const back = () => screen.getByRole('button', { name: 'Back to ride' });
const titles = () =>
  screen.getAllByTestId('map-marker').map(pin => pin.props.title);

test('renders the empty state and lets the rider return', async () => {
  const onDone = jest.fn();
  await render(
    <RiderRideMapContainer
      activeRide={createActiveRideStore()}
      onDone={onDone}
    />,
  );
  expect(screen.getByText('No active ride right now.')).toBeOnTheScreen();
  expect(screen.queryByTestId('map-view')).toBeNull();
  await fireEvent.press(back());
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('gates live driver data by status and ride ID and recenters only on request', async () => {
  const activeRide = createActiveRideStore();
  const onDone = jest.fn();
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  activeRide.setState({ rider: ride, position, connectivity });
  await render(
    <RiderRideMapContainer activeRide={activeRide} onDone={onDone} />,
  );
  expect(titles()).toEqual(['Pickup', 'Dropoff']);
  expect(screen.queryByText(stale)).toBeNull();
  expect(screen.getByTestId('map-view')).toHaveProp('scrollEnabled', true);
  expect(screen.getByRole('progressbar')).toHaveProp(
    'accessibilityValue',
    expect.objectContaining({ now: 1 }),
  );

  await act(() =>
    activeRide.setState({
      rider: { ...ride, status: 'driver_assigned', version: 2 },
      position: { ...position, rideId: 'old' },
      connectivity: { ...connectivity, rideId: 'old' },
    }),
  );
  expect(titles()).toEqual(['Pickup', 'Dropoff']);
  expect(screen.queryByText(stale)).toBeNull();
  await act(() => activeRide.setState({ position, connectivity }));
  expect(titles()).toEqual(['Pickup', 'Dropoff', 'Driver']);
  expect(screen.getByText(stale)).toBeOnTheScreen();
  expect(animateToRegion).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Recenter map' }));
  expect(animateToRegion).toHaveBeenCalledTimes(1);
  expect(animateToRegion.mock.calls[0][0]).toMatchObject({
    latitude: 11.575,
    longitude: 104.915,
  });
  expect(animateToRegion.mock.calls[0][0].latitudeDelta).toBeCloseTo(0.09);
  expect(screen.queryByRole('button', { name: 'Back to ride' })).toBeNull();

  await act(() =>
    activeRide
      .getState()
      .applyRide({ ...ride, status: 'completed', version: 3 }, 'rider'),
  );
  expect(
    screen.getByText('✓ Done', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(titles()).toEqual(['Pickup', 'Dropoff']);
  expect(screen.queryByText(stale)).toBeNull();
  await fireEvent.press(back());
  expect(onDone).toHaveBeenCalledTimes(1);
  await act(() =>
    activeRide.getState().applyRide({ ...ride, id: 'different' }, 'rider'),
  );
  expect(announce.mock.calls).toEqual([
    ['Driver assigned'],
    [stale],
    ['Ride completed'],
  ]);
});

test('renders the dark Khmer Android fallback without recentering or a terminal progress bar', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const activeRide = createActiveRideStore();
  activeRide.getState().applyRide({ ...ride, status: 'cancelled' }, 'rider');
  const onDone = jest.fn();
  await render(
    <LanguageContext.Provider value="km">
      <RiderRideMapContainer activeRide={activeRide} onDone={onDone} />
    </LanguageContext.Provider>,
  );
  expect(
    screen.getByRole('header', { name: 'ការធ្វើដំណើរត្រូវបានបោះបង់' }),
  ).toHaveStyle({ color: themes.dark.text });
  expect(
    screen.container.queryAll(node => node.type === 'RCTScrollView'),
  ).toHaveLength(1);
  expect(screen.getByRole('image')).toHaveStyle({
    backgroundColor: themes.dark.surface,
    flex: 1,
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByTestId('map-view')).toBeNull();
  const [backButton] = screen.getAllByRole('button');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(backButton).toHaveProp('accessibilityLabel', 'ត្រឡប់ទៅការធ្វើដំណើរ');
  await fireEvent.press(backButton);
  expect(onDone).toHaveBeenCalledTimes(1);
});
