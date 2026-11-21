import { createContext, useContext } from 'react';
import { Image, Platform, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
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
  accessibilityLabel,
  unavailableLabel,
  style,
}: Props) {
  const { colors, dark } = useTheme();
  const styles = useStyles();
  const androidMapsConfigured = useContext(AndroidMapsContext);
  const android = Platform.OS === 'android';
  const available = Platform.OS === 'ios' || (android && androidMapsConfigured);

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

  const region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };

  return (
    <View
      style={[styles.frame, style]}
      accessible={!interactive}
      accessibilityRole={interactive ? undefined : 'image'}
      accessibilityLabel={interactive ? undefined : accessibilityLabel}
    >
      <MapView
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
      >
        {pins?.map(({ id, point, title, kind }) => {
          const coordinate = { latitude: point.lat, longitude: point.lng };
          return kind ? (
            <Marker
              key={`${id}:${dark ? 'dark' : 'light'}`}
              coordinate={coordinate}
              title={title}
              anchor={PIN_ANCHOR}
            >
              <View style={[styles.pinBadge, styles[`pinBadge_${kind}`]]}>
                <Image
                  accessible={false}
                  source={PIN_ICONS[kind]}
                  style={[styles.pinIcon, styles[`pinIcon_${kind}`]]}
                />
              </View>
            </Marker>
          ) : (
            <Marker
              key={id}
              coordinate={coordinate}
              title={title}
              pinColor={colors.primary}
            />
          );
        })}
      </MapView>
    </View>
  );
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
