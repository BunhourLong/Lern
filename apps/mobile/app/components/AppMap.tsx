import { createContext, useContext } from 'react';
import { Platform, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Point } from '@lern/contracts';
import {
  darkMapStyle,
  makeStyles,
  mapHeight,
  outlineWidth,
  radius,
  spacing,
  useTheme,
} from '@theme';
import { Text } from './Text';

export const AndroidMapsContext = createContext(false);

export type MapPin = { id: string; point: Point; title?: string };

type Props = {
  center: Point;
  pins?: readonly MapPin[];
  delta?: number;
  interactive?: boolean;
  accessibilityLabel: string;
  unavailableLabel: string;
  style?: StyleProp<ViewStyle>;
};

export function AppMap({
  center,
  pins,
  delta = 0.008,
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
        style={[styles.frame, styles.fallback, style]}
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
        style={styles.map}
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
        {pins?.map(pin => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.point.lat, longitude: pin.point.lng }}
            title={pin.title}
            pinColor={colors.primary}
          />
        ))}
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
  map: { height: mapHeight.mini, width: '100%' },
  fallback: {
    backgroundColor: t.colors.surface,
    minHeight: mapHeight.mini,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
}));
