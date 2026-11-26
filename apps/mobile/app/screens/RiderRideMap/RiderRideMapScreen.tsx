import type { Point, Ride } from '@lern/contracts';
import { useContext } from 'react';
import { Platform, View } from 'react-native';
import { makeStyles, spacing } from '@theme';
import { AndroidMapsContext, AppMap } from '../../components/AppMap';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { GlassSurface } from '../../components/GlassSurface';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useT } from '../../i18n';
import {
  RideProgressBar,
  useRideStatusAnnouncement,
} from '../RiderBooking/components/RiderRideCard';
import {
  buildRiderRideMap,
  riderRideMapLabels,
  riderRideProgress,
} from '../RiderBooking/rider-ride';

export function RiderRideMapScreen({
  ride,
  cameraKey,
  onRecenter,
  onDone,
}: {
  ride?: Pick<Ride, 'id' | 'status' | 'pickup' | 'dropoff'> & {
    ended: boolean;
    driverPosition: Point | null;
    driverStale: boolean;
  };
  cameraKey: number;
  onRecenter: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const styles = useStyles();
  const androidMapsConfigured = useContext(AndroidMapsContext);
  const mapAvailable =
    Platform.OS === 'ios' ||
    (Platform.OS === 'android' && androidMapsConfigured);
  const statusTitle = ride && t(`notification.ride.${ride.status}`);
  const progress = ride && riderRideProgress(ride.status, t);
  useRideStatusAnnouncement(ride?.id, ride?.status, statusTitle);

  return (
    <Screen scroll edges={['left', 'right', 'bottom']}>
      {ride ? (
        <View style={styles.content}>
          <GlassSurface style={styles.group}>
            <Text role="title" accessibilityLiveRegion="polite">
              {statusTitle}
            </Text>
            {progress && <RideProgressBar {...progress} />}
            {ride.driverStale && (
              <Banner tone="warning" message={t('riderRide.driverStale')} />
            )}
          </GlassSurface>
          <AppMap
            size="full"
            interactive
            cameraKey={cameraKey}
            {...buildRiderRideMap({ ...ride, labels: riderRideMapLabels(t) })}
            accessibilityLabel={t(
              mapAvailable ? 'riderRide.map.live' : 'map.unavailable',
            )}
            unavailableLabel={t('map.unavailable')}
          />
          {(mapAvailable || ride.ended) && (
            <View style={styles.group}>
              {mapAvailable && (
                <Button
                  variant="secondary"
                  label={t('riderRide.recenter')}
                  onPress={onRecenter}
                />
              )}
              {ride.ended && (
                <Button label={t('riderRide.backToRide')} onPress={onDone} />
              )}
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.content, styles.empty]}>
          <Text centered>{t('riderRide.noActiveRide')}</Text>
          <Button
            variant="secondary"
            label={t('riderRide.backToRide')}
            onPress={onDone}
          />
        </View>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { flexGrow: 1, gap: spacing.md },
  group: { gap: spacing.sm },
  empty: { justifyContent: 'center' },
}));
