import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, useColorScheme } from 'react-native';
import MapView from 'react-native-maps';
import { darkMapStyle, mapHeight, themes } from '@theme';
import { AndroidMapsContext, AppMap } from './AppMap';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useColorScheme).mockReturnValue('light');
});
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

const pointEvent = { nativeEvent: { coordinate } };
const malformedEvents = [
  undefined,
  { nativeEvent: {} },
  { nativeEvent: { coordinate: { ...coordinate, latitude: NaN } } },
  { nativeEvent: { coordinate: { ...coordinate, longitude: Infinity } } },
];

test('forwards finite map presses only on an interactive map', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const onPressPoint = jest.fn();
  const map = <AppMap {...props} onPressPoint={onPressPoint} />;
  const { rerender } = await render(<AppMap {...map.props} interactive />);

  for (const event of malformedEvents)
    await fireEvent.press(screen.getByTestId('map-view'), event);
  await fireEvent.press(screen.getByTestId('map-view'), {
    nativeEvent: { coordinate, action: 'marker-press' },
  });
  const far = { latitude: 11.56, longitude: 104.93 };
  await fireEvent.press(screen.getByTestId('map-view'), {
    nativeEvent: { coordinate: far, action: 'press' },
  });
  expect(onPressPoint.mock.calls).toEqual([[{ lat: 11.56, lng: 104.93 }]]);

  await rerender(map);
  expect(screen.getByTestId('map-view').props.onPress).toBeUndefined();
});

test('ignores iOS Fabric map presses on and beside either pin', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const onPressPoint = jest.fn();
  const dropoff = { lat: 11.56, lng: 104.93 };
  await render(
    <AppMap
      {...props}
      interactive
      pins={[...props.pins, { id: 'dropoff', point: dropoff }]}
      onPressPoint={onPressPoint}
    />,
  );
  const map = screen.getByTestId('map-view');
  for (const point of [
    coordinate,
    { latitude: dropoff.lat + 0.0005, longitude: dropoff.lng - 0.0005 },
  ])
    await fireEvent.press(map, {
      nativeEvent: { action: 'press', coordinate: point },
    });

  expect(onPressPoint).not.toHaveBeenCalled();
});

test.each(['map', 'pin'] as const)(
  'ignores a map press for 300 ms after a marker event from the %s',
  async source => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const onPressPoint = jest.fn();
    await render(<AppMap {...props} interactive onPressPoint={onPressPoint} />);
    const map = screen.getByTestId('map-view');
    const event = {
      nativeEvent: {
        action: 'press',
        coordinate: { latitude: 11.56, longitude: 104.93 },
      },
    };
    const stopPropagation = jest.fn();
    if (source === 'map') await fireEvent(map, 'markerPress', pointEvent);
    else
      await fireEvent.press(screen.getByTestId('map-marker'), {
        ...pointEvent,
        stopPropagation,
      });
    onPressPoint.mockClear();
    now.mockReturnValue(1299);
    await fireEvent.press(map, event);
    expect(onPressPoint).not.toHaveBeenCalled();
    if (source === 'pin') expect(stopPropagation).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1300);
    await fireEvent.press(map, event);
    expect(onPressPoint).toHaveBeenCalledWith({ lat: 11.56, lng: 104.93 });
  },
);

test('tracks zoom for pin hit testing and resets it when recentering', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const onPressPoint = jest.fn();
  const mapProps = { ...props, interactive: true, onPressPoint };
  const { rerender } = await render(<AppMap {...mapProps} cameraKey={0} />);
  const event = {
    nativeEvent: {
      action: 'press',
      coordinate: {
        latitude: center.lat + 0.001,
        longitude: center.lng + 0.002,
      },
    },
  };
  const map = screen.getByTestId('map-view');
  await fireEvent.press(map, event);
  expect(onPressPoint).toHaveBeenCalledTimes(1);
  await fireEvent(map, 'regionChangeComplete', {
    ...region,
    latitudeDelta: 0.02,
    longitudeDelta: 0.04,
  });
  await fireEvent(map, 'regionChangeComplete', {
    ...region,
    latitudeDelta: -1,
    longitudeDelta: Infinity,
  });
  await fireEvent.press(map, event);
  expect(onPressPoint).toHaveBeenCalledTimes(1);
  await rerender(<AppMap {...mapProps} cameraKey={1} />);
  await fireEvent.press(screen.getByTestId('map-view'), event);
  expect(onPressPoint).toHaveBeenCalledTimes(2);
});

test('enables dragging and forwards finite coordinates for interactive pins with a handler', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const onDragEnd = jest.fn();
  const map = (
    <AppMap {...props} pins={[...props.pins, { ...pins[0], onDragEnd }]} />
  );
  const { rerender } = await render(<AppMap {...map.props} interactive />);
  const [fixed, draggable] = screen.getAllByTestId('map-marker');
  expect(fixed.props.draggable).toBeFalsy();
  expect(draggable.props.draggable).toBe(true);
  for (const event of malformedEvents)
    await fireEvent(draggable, 'dragEnd', event);
  await fireEvent(draggable, 'dragEnd', pointEvent);
  expect(onDragEnd.mock.calls).toEqual([[center]]);

  await rerender(map);
  const marker = screen.getAllByTestId('map-marker')[1];
  expect(marker.props.draggable).toBeFalsy();
  expect(marker.props.onDragEnd).toBeUndefined();
});

test('animates only when the camera key changes on an interactive map', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const { animateToRegion } = MapView as unknown as {
    animateToRegion: jest.Mock;
  };
  const { rerender } = await render(
    <AppMap {...props} cameraKey={0} interactive />,
  );
  expect(animateToRegion).not.toHaveBeenCalled();

  const nextCenter = { lat: 11.57, lng: 104.94 };
  const next = { ...props, center: nextCenter };
  await rerender(<AppMap {...next} cameraKey={0} interactive />);
  expect(animateToRegion).not.toHaveBeenCalled();

  await rerender(<AppMap {...next} cameraKey={1} interactive />);
  expect(animateToRegion).toHaveBeenCalledTimes(1);
  expect(animateToRegion).toHaveBeenCalledWith(
    {
      ...region,
      latitude: nextCenter.lat,
      longitude: nextCenter.lng,
    },
    250,
  );

  await rerender(<AppMap {...props} cameraKey={1} interactive />);
  await rerender(<AppMap {...props} cameraKey={2} />);
  expect(animateToRegion).toHaveBeenCalledTimes(1);
});

test.each(['light', 'dark'] as const)(
  'fills the available iOS map space in %s mode',
  async scheme => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await render(<AppMap {...props} size="full" interactive />);
    const map = screen.getByTestId('map-view');
    expect(map).toHaveStyle({ flex: 1, minHeight: mapHeight.active });
    expect(map.parent).toHaveStyle({ flex: 1, minHeight: mapHeight.active });
    expect(map.props).toMatchObject({
      userInterfaceStyle: scheme,
      scrollEnabled: true,
    });
  },
);

test.each(['light', 'dark'] as const)(
  'fills the available Android fallback space in %s mode',
  async scheme => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await render(<AppMap {...props} size="full" interactive />);
    expect(screen.queryByTestId('map-view')).toBeNull();
    expect(
      screen.getByRole('image', { name: props.accessibilityLabel }),
    ).toHaveStyle({
      flex: 1,
      minHeight: mapHeight.active,
      backgroundColor: themes[scheme].surface,
      borderColor: themes[scheme].border,
    });
    expect(screen.getByText(props.unavailableLabel)).toBeOnTheScreen();
  },
);
