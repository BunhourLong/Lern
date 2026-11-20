import type { DriverAvailability, DriverVerification } from '@lern/contracts';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useT, type StringKey } from '../../i18n';
import RouteMessageScreen from '../RouteMessage/RouteMessageScreen';

export default function DriverStatusScreen({
  verification,
  availability,
  connected,
  busy,
  error,
  locationNotice,
  onToggle,
  onOpenSettings,
  onDebug,
  edges,
}: {
  verification: DriverVerification | null;
  availability: DriverAvailability | null;
  connected: boolean;
  busy: boolean;
  error?: StringKey;
  locationNotice?: 'warning' | 'danger';
  onToggle: () => void;
  onOpenSettings: () => void;
  onDebug?: () => void;
  edges?: Edge[];
}) {
  const t = useT();
  const debug = onDebug && { label: t('route.debug'), onPress: onDebug };
  const verified = verification === 'verified';
  const availabilityLabel = t(
    `driverStatus.availability.${availability ?? 'loading'}`,
  );
  const previousAvailability = useRef(availability);
  useEffect(() => {
    if (
      Platform.OS === 'ios' &&
      verified &&
      previousAvailability.current !== availability
    )
      AccessibilityInfo.announceForAccessibility(availabilityLabel);
    previousAvailability.current = availability;
  }, [availability, availabilityLabel, verified]);

  if (verification === null) {
    return (
      <RouteMessageScreen
        loadingLabel={t('route.loading')}
        secondaryAction={debug}
        edges={edges}
      />
    );
  }

  return (
    <RouteMessageScreen
      title={t(`driverStatus.${verification}.title`)}
      body={
        !verified || availability === 'offline'
          ? t(`driverStatus.${verification}.body`)
          : undefined
      }
      secondaryAction={debug}
      edges={edges}
    >
      {verified && (
        <>
          {!connected && <Banner message={t('driverStatus.reconnecting')} />}
          <Text role="bodyStrong" accessibilityLiveRegion="polite">
            {availabilityLabel}
          </Text>
          {(availability === 'offline' || availability === 'available') && (
            <Button
              label={t(
                availability === 'offline'
                  ? 'driverStatus.goOnline'
                  : 'driverStatus.goOffline',
              )}
              onPress={onToggle}
              disabled={!connected}
              loading={busy}
            />
          )}
          {error && <Banner tone="danger" message={t(error)} />}
          {locationNotice && (
            <>
              <Banner
                tone={locationNotice}
                message={t(`driverStatus.location.${locationNotice}`)}
              />
              <Button
                variant="secondary"
                label={t('driverStatus.openSettings')}
                onPress={onOpenSettings}
              />
            </>
          )}
        </>
      )}
    </RouteMessageScreen>
  );
}
