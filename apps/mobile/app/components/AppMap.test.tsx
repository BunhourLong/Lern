import { render, screen } from '@testing-library/react-native';
import { Platform, useColorScheme } from 'react-native';
import { darkMapStyle, mapHeight, themes } from '@theme';
import { AndroidMapsContext, AppMap } from './AppMap';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

beforeEach(() => jest.mocked(useColorScheme).mockReturnValue('light'));
afterEach(() => jest.restoreAllMocks());

const center = { lat: 11.55, lng: 104.92 };
const coordinate = { latitude: center.lat, longitude: center.lng };
const region = { ...coordinate, latitudeDelta: 0.008, longitudeDelta: 0.008 };
const props = {
  center,
  pins: [{ id: 'pickup', point: center, title: 'Pickup' }],
  accessibilityLabel: 'Pickup location map',
  unavailableLabel: 'Map preview unavailable',
};

test.each(['light', 'dark'] as const)(
  'renders an iOS pickup map in %s mode',
  async scheme => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(useColorScheme).mockReturnValue(scheme);

    await render(<AppMap {...props} />);

    expect(
      screen.getByRole('image', { name: props.accessibilityLabel }),
    ).toBeOnTheScreen();
    const map = screen.getByTestId('map-view');
    expect(map.props.provider).toBeUndefined();
    expect(map.props.customMapStyle).toBeUndefined();
    expect(map.props).toMatchObject({
      userInterfaceStyle: scheme,
      initialRegion: region,
      region,
      scrollEnabled: false,
      zoomEnabled: false,
      rotateEnabled: false,
      pitchEnabled: false,
      toolbarEnabled: false,
      pointerEvents: 'none',
    });
    expect(screen.getByTestId('map-marker').props).toMatchObject({
      coordinate,
      title: 'Pickup',
      pinColor: themes[scheme].primary,
    });
  },
);

test('updates the controlled region when the center changes', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const { rerender } = await render(<AppMap {...props} />);
  const nextCenter = { lat: 11.59, lng: 104.88 };

  await rerender(<AppMap {...props} center={nextCenter} />);

  expect(screen.getByTestId('map-view').props.region).toEqual({
    ...region,
    latitude: nextCenter.lat,
    longitude: nextCenter.lng,
  });
});

test('allows gestures and uses only the initial region when interactive', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  await render(<AppMap {...props} delta={0.025} interactive />);

  const map = screen.getByLabelText(props.accessibilityLabel);
  expect(map.props.region).toBeUndefined();
  expect(map.props).toMatchObject({
    testID: 'map-view',
    initialRegion: {
      ...coordinate,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    },
    scrollEnabled: true,
    zoomEnabled: true,
    rotateEnabled: true,
    pitchEnabled: true,
    pointerEvents: 'auto',
  });
  expect(screen.queryByRole('image')).toBeNull();
});

test.each(['light', 'dark'] as const)(
  'shows the %s fallback on unconfigured Android',
  async scheme => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(useColorScheme).mockReturnValue(scheme);

    await render(<AppMap {...props} />);

    expect(screen.queryByTestId('map-view')).toBeNull();
    expect(
      screen.getByLabelText(props.accessibilityLabel).props.accessible,
    ).toBe(true);
    expect(screen.getByLabelText(props.accessibilityLabel)).toHaveStyle({
      backgroundColor: themes[scheme].surface,
      borderColor: themes[scheme].border,
      minHeight: mapHeight.mini,
    });
    expect(screen.getByText(props.unavailableLabel)).toHaveStyle({
      color: themes[scheme].textMuted,
    });
  },
);

test.each(['light', 'dark'] as const)(
  'renders Google Maps on configured Android in %s mode',
  async scheme => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(useColorScheme).mockReturnValue(scheme);

    await render(
      <AndroidMapsContext.Provider value>
        <AppMap {...props} />
      </AndroidMapsContext.Provider>,
    );

    expect(screen.getByTestId('map-view').props).toMatchObject({
      provider: 'google',
      customMapStyle: scheme === 'dark' ? darkMapStyle : [],
    });
    expect(screen.getByTestId('map-marker').props).toMatchObject({
      coordinate,
      title: 'Pickup',
      pinColor: themes[scheme].primary,
    });
  },
);

const pins = (['rider', 'driver', 'dropoff'] as const).map(kind => ({
  id: kind,
  title: kind,
  kind,
  point: center,
}));

test('renders active badges, retints them on theme changes and keeps the default pin', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const map = (
    <AppMap {...props} size="active" pins={[...props.pins, ...pins]} />
  );
  const { rerender } = await render(map);
  for (const scheme of ['light', 'dark'] as const) {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await rerender(
      <AppMap {...props} size="active" pins={[...props.pins, ...pins]} />,
    );
    expect(screen.getByTestId('map-view')).toHaveStyle({ height: 240 });
    const [legacy, rider, driver, dropoff] =
      screen.getAllByTestId('map-marker');
    const { primary, surface, onPrimary, danger, onStatus } = themes[scheme];
    expect(legacy.props.pinColor).toBe(primary);
    expect(legacy.children).toHaveLength(0);
    for (const [marker, backgroundColor, borderColor, tintColor] of [
      [rider, primary, surface, onPrimary],
      [driver, surface, primary, primary],
      [dropoff, danger, surface, onStatus],
    ] as const) {
      expect(marker.props.anchor).toEqual({ x: 0.5, y: 0.5 });
      expect(marker.children[0]).toHaveStyle({
        backgroundColor,
        borderColor,
        width: 36,
        height: 36,
        borderWidth: 2,
      });
      const [icon] = marker.queryAll(node => node.props.source !== undefined);
      expect(icon).toHaveStyle({ tintColor, width: 20, height: 20 });
      expect(icon.props.accessible).toBe(false);
      expect(icon.props.source).toBeDefined();
    }
  }
});

test('shows an accessible full-height fallback on unconfigured Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await render(<AppMap {...props} size="active" pins={pins} />);
  const fallback = screen.getByLabelText(props.accessibilityLabel);
  expect(fallback.props.accessible).toBe(true);
  expect(fallback).toHaveStyle({ minHeight: 240 });
  expect(screen.queryByTestId('map-marker')).toBeNull();
});
