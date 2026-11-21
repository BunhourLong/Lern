import type {
  DriverAvailability,
  DriverVerification,
  Offer,
  Point,
  Ride,
} from '@lern/contracts';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { MapPin } from '../../components/AppMap';
import { Banner } from '../../components/Banner';
import { frameMapRegion } from '../../components/map-region';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useT, type StringKey } from '../../i18n';
import RouteMessageScreen from '../RouteMessage/RouteMessageScreen';
import { DriverRideCard } from './components/DriverRideCard';
import {
  type ActiveDriverRideStatus,
  DRIVER_CANCEL_REASONS,
  type DriverCancelReason,
  type DriverStepAction,
} from './driver-ride';
import { OfferCard } from './components/OfferCard';
import { formatOfferDistance, formatOfferFare } from './offer-format';

export type OfferAction = 'accept' | 'decline';

export type DriverHomeOffer = { id: string } & (
  | {
      status: 'pending';
      details: Pick<Offer, 'distanceM' | 'fare' | 'vehicleType' | 'pickup'>;
      seconds: number;
      disabled: boolean;
      busy?: OfferAction;
      error?: StringKey;
    }
  | { status: 'expired' | 'unavailable' | 'accepted' | 'declined' }
);

export type DriverHomeRide = Pick<Ride, 'id' | 'fare' | 'vehicleType'> &
  (
    | (Pick<Ride, 'pickup' | 'dropoff'> & {
        variant: 'active';
        status: ActiveDriverRideStatus;
        driverPosition: Point | null;
        step: {
          action: DriverStepAction;
          disabled: boolean;
          loading: boolean;
          error?: StringKey;
          onPress: () => void;
        };
        queuedNotice: boolean;
        cancel?: {
          open: boolean;
          disabled: boolean;
          loading: boolean;
          selected?: DriverCancelReason;
          error?: StringKey;
          onOpen: () => void;
          onKeep: () => void;
          onSelect: (value: DriverCancelReason) => void;
          onConfirm: () => void;
        };
      })
    | {
        variant: 'ended';
        status: 'completed' | 'cancelled';
        onDismiss: () => void;
      }
  );

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
  offer,
  ride,
  onOfferAction,
  onDismissOffer,
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
  offer?: DriverHomeOffer;
  ride?: DriverHomeRide;
  onOfferAction: (id: string, action: OfferAction) => void;
  onDismissOffer: (id: string) => void;
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

  const offerId = offer?.id;
  const offerStatus = offer?.status;
  const offerTitle = offerStatus && t(`driverOffer.${offerStatus}`);
  const lastAnnouncedOffer = useRef<{ id: string; ended: boolean } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!offerId || !offerStatus || !offerTitle) return;
    const ended = offerStatus !== 'pending';
    const previous = lastAnnouncedOffer.current;
    if (previous?.id === offerId && (previous.ended || !ended)) return;
    if (
      previous?.id === offerId ||
      (offerStatus !== 'accepted' && offerStatus !== 'declined')
    )
      AccessibilityInfo.announceForAccessibility(offerTitle);
    lastAnnouncedOffer.current = { id: offerId, ended };
  }, [offerId, offerStatus, offerTitle]);

  const rideId = ride?.id;
  const rideStatus = ride?.status;
  const rideTitle = rideStatus && t(`driverRide.status.${rideStatus}`);
  const previousRide = useRef<
    { id: string; status: DriverHomeRide['status'] } | undefined
  >(undefined);
  useEffect(() => {
    const previous = previousRide.current;
    if (
      Platform.OS === 'ios' &&
      rideTitle &&
      previous &&
      previous.id === rideId &&
      previous.status !== rideStatus
    ) {
      AccessibilityInfo.announceForAccessibility(rideTitle);
    }
    previousRide.current =
      rideId && rideStatus ? { id: rideId, status: rideStatus } : undefined;
  }, [rideId, rideStatus, rideTitle]);

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
        <Text role="bodyStrong" accessibilityLiveRegion="polite">
          {availabilityLabel}
        </Text>
      )}
      {ride && rideTitle && <DriverRideContent ride={ride} title={rideTitle} />}
      {verified && (
        <>
          {offerTitle && offer?.status === 'pending' && (
            <OfferCard
              title={offerTitle}
              pending={{
                pickup: offer.details.pickup,
                mapLabel: t('driverOffer.pickupMap'),
                mapUnavailable: t('map.unavailable'),
                pickupPinLabel: t('driverOffer.pickupPin'),
                distance: t('driverOffer.pickupDistance', {
                  distance: formatOfferDistance(offer.details.distanceM, t),
                }),
                fare: t('driverOffer.fare', {
                  fare: formatOfferFare(offer.details.fare, t),
                }),
                vehicle: t('driverOffer.vehicle', {
                  vehicle: t(`driverApply.${offer.details.vehicleType}`),
                }),
                countdown: t('driverOffer.countdown', {
                  seconds: offer.seconds,
                }),
                accept: {
                  label: t('driverOffer.accept'),
                  onPress: () => onOfferAction(offer.id, 'accept'),
                },
                decline: {
                  label: t('driverOffer.decline'),
                  onPress: () => onOfferAction(offer.id, 'decline'),
                },
                disabled: offer.disabled,
                busy: offer.busy,
                error: offer.error && t(offer.error),
              }}
            />
          )}
          {offerTitle &&
            (offer?.status === 'expired' ||
              offer?.status === 'unavailable') && (
              <OfferCard
                title={offerTitle}
                dismiss={{
                  label: t('driverOffer.dismiss'),
                  onPress: () => onDismissOffer(offer.id),
                }}
              />
            )}
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

function DriverRideContent({
  ride,
  title,
}: {
  ride: DriverHomeRide;
  title: string;
}) {
  const t = useT();
  const summary = {
    title,
    fare: t('driverOffer.fare', { fare: formatOfferFare(ride.fare, t) }),
    vehicle: t('driverOffer.vehicle', {
      vehicle: t(`driverApply.${ride.vehicleType}`),
    }),
  };
  if (ride.variant === 'ended') {
    return (
      <DriverRideCard
        {...summary}
        variant="ended"
        dismiss={{ label: t('driverRide.dismiss'), onPress: ride.onDismiss }}
      />
    );
  }

  const target = ride.status === 'in_progress' ? 'dropoff' : 'pickup';
  const pins: MapPin[] = [
    {
      id: target,
      point: ride[target],
      kind: target === 'pickup' ? 'rider' : 'dropoff',
      title: t(`driverRide.pin.${target}`),
    },
  ];
  if (ride.driverPosition) {
    pins.push({
      id: 'driver',
      kind: 'driver',
      point: ride.driverPosition,
      title: t('driverRide.pin.driver'),
    });
  }
  const { step, cancel } = ride;
  return (
    <DriverRideCard
      {...summary}
      variant="active"
      map={{
        ...frameMapRegion(ride[target], ride.driverPosition),
        pins,
        label: t(`driverRide.map.${target}`),
        unavailableLabel: t('map.unavailable'),
      }}
      step={{
        label: t(`driverRide.step.${step.action}`),
        disabled: step.disabled,
        loading: step.loading,
        onPress: step.onPress,
      }}
      queuedNotice={ride.queuedNotice ? t('driverRide.stepQueued') : undefined}
      stepError={step.error && t(step.error)}
      cancel={
        cancel && {
          ...cancel,
          openLabel: t('driverRide.cancel.open'),
          prompt: t('driverRide.cancel.prompt'),
          reasons: DRIVER_CANCEL_REASONS.map(value => ({
            value,
            label: t(`driverRide.cancel.reason.${value}`),
          })),
          confirmLabel: t('driverRide.cancel.confirm'),
          keepLabel: t('driverRide.cancel.keep'),
          error: cancel.error && t(cancel.error),
        }
      }
    />
  );
}
