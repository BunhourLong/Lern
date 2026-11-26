import { createContext, useContext, useEffect, useRef } from 'react';
import { Image, Platform, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { LatLng } from 'react-native-maps';
import type { Point } from '@lern/contracts';
import {
  darkMapStyle,
  makeStyles,
  mapHeight,
  mapPinBorderWidth,
  mapPinIconSize,
  mapPinSize,
  outlineWidth,
  radius,
  spacing,
  useTheme,
} from '@theme';
import { Text } from './Text';

export const AndroidMapsContext = createContext(false);

export type MapPinKind = 'rider' | 'driver' | 'dropoff';
export type MapPin = {
  id: string;
  point: Point;
  title?: string;
  kind?: MapPinKind;
  onDragEnd?: (point: Point) => void;
};

const PIN_ANCHOR = { x: 0.5, y: 0.5 };
const PIN_ICONS = {
  rider: require('../assets/icons/account.png'),
  driver: require('../assets/icons/driver.png'),
  dropoff: require('../assets/icons/dropoff.png'),
};

type Props = {
  center: Point;
  pins?: readonly MapPin[];
  delta?: number;
  size?: keyof typeof mapHeight;
  interactive?: boolean;
  onPressPoint?: (point: Point) => void;
  cameraKey?: number;
  accessibilityLabel: string;
  unavailableLabel: string;
  style?: StyleProp<ViewStyle>;
};

export function AppMap({
  center,
  pins,
  delta = 0.008,
  size = 'mini',
  interactive = false,
  onPressPoint,
  cameraKey,
  accessibilityLabel,
  unavailableLabel,
  style,
}: Props) {
  const { colors, dark } = useTheme();
  const styles = useStyles();
  const androidMapsConfigured = useContext(AndroidMapsContext);
  const android = Platform.OS === 'android';
  const available = Platform.OS === 'ios' || (android && androidMapsConfigured);
  const mapRef = useRef<MapView>(null);
  const previousCameraKey = useRef(cameraKey);
  const lastMarkerPressAt = useRef(0);
  const liveDelta = useRef({ lat: delta, lng: delta });
  const { lat, lng } = center;
  useEffect(() => {
    if (!interactive) {
      liveDelta.current = { lat: delta, lng: delta };
      return;
    }
    if (cameraKey === undefined || previousCameraKey.current === cameraKey)
      return;
    previousCameraKey.current = cameraKey;
    liveDelta.current = { lat: delta, lng: delta };
    mapRef.current?.animateToRegion?.(mapRegion(lat, lng, delta), 250);
  }, [cameraKey, delta, interactive, lat, lng]);

  if (!available) {
    return (
      <View
        style={[
          styles.frame,
          styles.fallback,
          size === 'active' ? styles.activeFallback : styles.miniFallback,
          style,
        ]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        <Text role="caption" tone="muted" centered>
          {unavailableLabel}
        </Text>
      </View>
    );
  }

  const region = mapRegion(lat, lng, delta);
  const recordMarkerPress =
    interactive && onPressPoint
      ? () => {
          lastMarkerPressAt.current = Date.now();
        }
      : undefined;

  return (
    <View
      style={[styles.frame, style]}
      accessible={!interactive}
      accessibilityRole={interactive ? undefined : 'image'}
      accessibilityLabel={interactive ? undefined : accessibilityLabel}
    >
      <MapView
        ref={mapRef}
        style={[
          styles.map,
          size === 'active' ? styles.activeMap : styles.miniMap,
        ]}
        provider={android ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        region={interactive ? undefined : region}
        userInterfaceStyle={dark ? 'dark' : 'light'}
        customMapStyle={android ? (dark ? darkMapStyle : []) : undefined}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={interactive}
        toolbarEnabled={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        accessibilityLabel={interactive ? accessibilityLabel : undefined}
        onRegionChangeComplete={
          interactive
            ? ({ latitudeDelta, longitudeDelta }) => {
                if (
                  Number.isFinite(latitudeDelta) &&
                  latitudeDelta > 0 &&
                  Number.isFinite(longitudeDelta) &&
                  longitudeDelta > 0
                )
                  liveDelta.current = {
                    lat: latitudeDelta,
                    lng: longitudeDelta,
                  };
              }
            : undefined
        }
        onMarkerPress={recordMarkerPress}
        onPress={
          interactive && onPressPoint
            ? event => {
                if (
                  event?.nativeEvent?.action === 'marker-press' ||
                  Date.now() - lastMarkerPressAt.current < 300
                )
                  return;
                // shortcut: Use a region-relative hit area until iOS Fabric identifies pin taps.
                forwardPoint(event?.nativeEvent?.coordinate, point => {
                  const view = liveDelta.current;
                  if (
                    !pins?.some(
                      ({ point: pin }) =>
                        Math.abs(point.lat - pin.lat) <= view.lat * 0.08 &&
                        Math.abs(point.lng - pin.lng) <= view.lng * 0.08,
                    )
                  )
                    onPressPoint(point);
                });
              }
            : undefined
        }
      >
        {pins?.map(({ id, point, title, kind, onDragEnd }) => {
          const draggable = interactive && onDragEnd !== undefined;
          return (
            <Marker
              key={kind ? `${id}:${dark ? 'dark' : 'light'}` : id}
              coordinate={{ latitude: point.lat, longitude: point.lng }}
              title={title}
              anchor={kind ? PIN_ANCHOR : undefined}
              pinColor={kind ? undefined : colors.primary}
              draggable={draggable || undefined}
              onPress={
                recordMarkerPress
                  ? event => {
                      recordMarkerPress();
                      event?.stopPropagation?.();
                    }
                  : undefined
              }
              onDragEnd={
                interactive && onDragEnd
                  ? event =>
                      forwardPoint(event?.nativeEvent?.coordinate, onDragEnd)
                  : undefined
              }
            >
              {kind && (
                <View style={[styles.pinBadge, styles[`pinBadge_${kind}`]]}>
                  <Image
                    accessible={false}
                    source={PIN_ICONS[kind]}
                    style={[styles.pinIcon, styles[`pinIcon_${kind}`]]}
                  />
                </View>
              )}
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
}

function mapRegion(latitude: number, longitude: number, delta: number) {
  return { latitude, longitude, latitudeDelta: delta, longitudeDelta: delta };
}

function forwardPoint(
  coordinate: LatLng | undefined,
  onPoint: (point: Point) => void,
) {
  if (
    coordinate &&
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude)
  )
    onPoint({ lat: coordinate.latitude, lng: coordinate.longitude });
}

const useStyles = makeStyles(t => ({
  frame: {
    borderRadius: radius.md,
    borderWidth: outlineWidth,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  map: { width: '100%' },
  miniMap: { height: mapHeight.mini },
  activeMap: { height: mapHeight.active },
  miniFallback: { minHeight: mapHeight.mini },
  activeFallback: { minHeight: mapHeight.active },
  fallback: {
    backgroundColor: t.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  pinBadge: {
    width: mapPinSize,
    height: mapPinSize,
    borderRadius: radius.pill,
    borderWidth: mapPinBorderWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinBadge_rider: {
    backgroundColor: t.colors.primary,
    borderColor: t.colors.surface,
  },
  pinBadge_driver: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.primary,
  },
  pinBadge_dropoff: {
    backgroundColor: t.colors.danger,
    borderColor: t.colors.surface,
  },
  pinIcon: { width: mapPinIconSize, height: mapPinIconSize },
  pinIcon_rider: { tintColor: t.colors.onPrimary },
  pinIcon_driver: { tintColor: t.colors.primary },
  pinIcon_dropoff: { tintColor: t.colors.onStatus },
}));
