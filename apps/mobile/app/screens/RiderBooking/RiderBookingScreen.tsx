import type { Point, Quote, Ride, VehicleType } from '@lern/contracts';
import { useContext, useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, Pressable, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import {
  makeStyles,
  mapPinBorderWidth,
  opacity,
  outlineWidth,
  radius,
  spacing,
  touch,
} from '@theme';
import {
  AndroidMapsContext,
  AppMap,
  type MapPin,
} from '../../components/AppMap';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { GlassSurface } from '../../components/GlassSurface';
import { frameMapRegion } from '../../components/map-region';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useInteraction } from '../../hooks/use-interaction';
import { useT, type StringKey } from '../../i18n';
import { formatDistance } from '../../utils/trip-format';
import {
  type ActiveRiderRideStatus,
  findPresetId,
  formatPoint,
  formatQuotePrice,
  PHNOM_PENH_PRESETS,
  type PresetId,
  VEHICLE_TYPES,
} from './rider-booking';

export type BookingEndpoint = 'pickup' | 'dropoff';
export type PickupSource = 'preset' | 'map' | 'gps';
type ActiveRide = Pick<Ride, 'pickup' | 'dropoff' | 'fare' | 'vehicleType'> & {
  status: ActiveRiderRideStatus;
};

export type RiderBookingForm = {
  pickup: Point;
  pickupSource: PickupSource;
  dropoff: Point | null;
  target: BookingEndpoint;
  vehicleType: VehicleType;
  cameraKey: number;
  pinRevision: number;
  quote?: { quote: Quote; seconds: number; expired: boolean };
  busy: boolean;
  locating: boolean;
  quoting: boolean;
  booking: boolean;
  samePoint: boolean;
  canQuote: boolean;
  canBook: boolean;
  locationError?: StringKey;
  quoteError?: StringKey;
  bookError?: StringKey;
  onSelectTarget: (target: BookingEndpoint) => void;
  onSelectPreset: (preset: PresetId) => void;
  onSelectVehicle: (vehicleType: VehicleType) => void;
  onUseCurrentLocation: () => void;
  onMapPress: (point: Point) => void;
  onDragPickup: (point: Point) => void;
  onDragDropoff: (point: Point) => void;
  onRequestQuote: () => void;
  onBook: () => void;
};

export default function RiderBookingScreen({
  activeRide,
  booking,
  khrPerUsd,
  edges,
  onDebug,
}: {
  khrPerUsd: number | null;
  edges?: Edge[];
  onDebug?: () => void;
} & (
  | { activeRide: ActiveRide; booking?: never }
  | { booking: RiderBookingForm; activeRide?: never }
)) {
  const t = useT();
  const styles = useStyles();
  const androidMapsConfigured = useContext(AndroidMapsContext);
  const mapAvailable =
    Platform.OS === 'ios' ||
    (Platform.OS === 'android' && androidMapsConfigured);
  const status = activeRide?.status;
  const statusLabel = status && t(`notification.ride.${status}`);
  const previousStatus = useRef<ActiveRiderRideStatus | undefined>(undefined);
  useEffect(() => {
    if (
      Platform.OS === 'ios' &&
      statusLabel &&
      previousStatus.current !== undefined &&
      previousStatus.current !== status
    )
      AccessibilityInfo.announceForAccessibility(statusLabel);
    previousStatus.current = status;
  }, [status, statusLabel]);

  return (
    <Screen scroll edges={edges}>
      <View style={styles.content}>
        <Text role="title">{t('route.rider.title')}</Text>
        {activeRide ? (
          <GlassSurface style={styles.card}>
            <Text role="bodyStrong" accessibilityLiveRegion="polite">
              {statusLabel}
            </Text>
            <AppMap
              size="active"
              {...frameMapRegion(activeRide.pickup, activeRide.dropoff)}
              pins={[
                {
                  id: 'pickup',
                  point: activeRide.pickup,
                  kind: 'rider',
                  title: t('riderBooking.pickup'),
                },
                {
                  id: 'dropoff',
                  point: activeRide.dropoff,
                  kind: 'dropoff',
                  title: t('riderBooking.dropoff'),
                },
              ]}
              accessibilityLabel={t(
                mapAvailable ? 'riderBooking.activeMap' : 'map.unavailable',
              )}
              unavailableLabel={t('map.unavailable')}
            />
            <TripPrice trip={activeRide} khrPerUsd={khrPerUsd} />
            <Text tone="muted">{t('riderBooking.activeRideNotice')}</Text>
          </GlassSurface>
        ) : (
          <BookingForm
            booking={booking}
            khrPerUsd={khrPerUsd}
            mapAvailable={mapAvailable}
          />
        )}
        {onDebug && (
          <Button
            variant="secondary"
            label={t('route.debug')}
            onPress={onDebug}
          />
        )}
      </View>
    </Screen>
  );
}

function BookingForm({
  booking,
  khrPerUsd,
  mapAvailable,
}: {
  booking: RiderBookingForm;
  khrPerUsd: number | null;
  mapAvailable: boolean;
}) {
  const t = useT();
  const styles = useStyles();
  const interact = useInteraction();
  const { pickup, pickupSource, dropoff, pinRevision, target, busy, quote } =
    booking;
  const locationError = booking.locationError && t(booking.locationError);
  const samePointError = booking.samePoint
    ? t('riderBooking.error.samePoint')
    : undefined;
  const quoteError = booking.quoteError && t(booking.quoteError);
  const bookError =
    quote &&
    booking.bookError &&
    booking.bookError !== 'riderBooking.error.quoteExpired'
      ? t(booking.bookError)
      : undefined;
  const previousErrors = useRef<(string | undefined)[]>([]);
  useEffect(() => {
    const errors = [locationError, samePointError, quoteError, bookError];
    if (Platform.OS === 'ios')
      errors.forEach((message, index) => {
        if (message && message !== previousErrors.current[index])
          AccessibilityInfo.announceForAccessibility(message);
      });
    previousErrors.current = errors;
  }, [locationError, samePointError, quoteError, bookError]);

  const pointHandler = (onPoint: (point: Point) => void) =>
    busy
      ? undefined
      : (point: Point) => {
          if (interact()) onPoint(point);
        };
  const pins: MapPin[] = [
    {
      id: `pickup:${pinRevision}`,
      point: pickup,
      kind: 'rider',
      title: t('riderBooking.pickup'),
      onDragEnd: pointHandler(booking.onDragPickup),
    },
  ];
  if (dropoff)
    pins.push({
      id: `dropoff:${pinRevision}`,
      point: dropoff,
      kind: 'dropoff',
      title: t('riderBooking.dropoff'),
      onDragEnd: pointHandler(booking.onDragDropoff),
    });
  const placeName = (point: Point) => {
    const preset = findPresetId(point);
    return preset ? t(`riderBooking.preset.${preset}`) : formatPoint(point);
  };
  const summaries = {
    pickup:
      pickupSource === 'gps'
        ? t('riderBooking.currentLocation')
        : pickupSource === 'preset'
        ? placeName(pickup)
        : formatPoint(pickup),
    dropoff: dropoff
      ? placeName(dropoff)
      : t('riderBooking.dropoffPlaceholder'),
  };

  return (
    <>
      <AppMap
        size="active"
        interactive
        {...frameMapRegion(pickup, dropoff)}
        cameraKey={booking.cameraKey}
        onPressPoint={pointHandler(booking.onMapPress)}
        pins={pins}
        accessibilityLabel={t(
          mapAvailable ? 'riderBooking.mapLabel' : 'map.unavailable',
        )}
        unavailableLabel={t('map.unavailable')}
      />
      <Text role="caption" tone="muted">
        {t(
          mapAvailable
            ? 'riderBooking.mapHint'
            : 'riderBooking.mapHintFallback',
        )}
      </Text>
      <View
        accessible={Platform.OS === 'android'}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('riderBooking.targetGroup')}
        style={styles.group}
      >
        {(['pickup', 'dropoff'] as const).map(endpoint => (
          <RadioOption
            key={endpoint}
            label={t(`riderBooking.${endpoint}`)}
            valueText={summaries[endpoint]}
            checked={target === endpoint}
            disabled={busy}
            onPress={() => booking.onSelectTarget(endpoint)}
          />
        ))}
      </View>
      <Button
        variant="secondary"
        label={t('riderBooking.useCurrentLocation')}
        onPress={booking.onUseCurrentLocation}
        loading={booking.locating}
        disabled={busy}
      />
      {locationError && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {locationError}
        </Text>
      )}
      <View style={styles.group}>
        <Text role="bodyStrong">{t('riderBooking.presetsTitle')}</Text>
        <View style={styles.presets}>
          {PHNOM_PENH_PRESETS.map(({ id }) => {
            const label = t(`riderBooking.preset.${id}`);
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => {
                  if (interact()) booking.onSelectPreset(id);
                }}
                style={({ pressed }) => [
                  styles.option,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text role="bodyStrong" tone="primary">
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View
        accessible={Platform.OS === 'android'}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('driverApply.vehicle')}
        style={styles.group}
      >
        <Text
          role="bodyStrong"
          accessibilityRole="header"
          importantForAccessibility="no"
        >
          {t('driverApply.vehicle')}
        </Text>
        {VEHICLE_TYPES.map(vehicle => (
          <RadioOption
            key={vehicle}
            label={t(`driverApply.${vehicle}`)}
            hint={t(`driverApply.${vehicle}.hint`)}
            checked={booking.vehicleType === vehicle}
            disabled={busy}
            onPress={() => booking.onSelectVehicle(vehicle)}
          />
        ))}
      </View>
      {samePointError && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {samePointError}
        </Text>
      )}
      <Button
        label={t(quote ? 'riderBooking.getNewQuote' : 'riderBooking.getQuote')}
        variant={quote && !quote.expired ? 'secondary' : 'primary'}
        onPress={booking.onRequestQuote}
        loading={booking.quoting}
        disabled={!booking.canQuote}
      />
      {quoteError && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {quoteError}
        </Text>
      )}
      {quote && (
        <GlassSurface style={styles.card}>
          <Text>
            {t('riderBooking.quote.distance', {
              distance: formatDistance(quote.quote.distanceM, t),
            })}
          </Text>
          <TripPrice trip={quote.quote} khrPerUsd={khrPerUsd} />
          {quote.expired ? (
            <Banner
              tone="warning"
              message={t('riderBooking.error.quoteExpired')}
            />
          ) : quote.seconds > 0 ? (
            <Text role="bodyStrong">
              {t('riderBooking.quote.expiresIn', { seconds: quote.seconds })}
            </Text>
          ) : null}
          <Button
            label={t('riderBooking.book')}
            onPress={booking.onBook}
            loading={booking.booking}
            disabled={!booking.canBook}
          />
          {bookError && (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {bookError}
            </Text>
          )}
        </GlassSurface>
      )}
    </>
  );
}

function RadioOption({
  label,
  hint,
  valueText,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  hint?: string;
  valueText?: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const interact = useInteraction();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={valueText ? { text: valueText } : undefined}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (interact()) onPress();
      }}
      style={({ pressed }) => [
        styles.option,
        checked && styles.checked,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.optionHeader}>
        <View style={styles.optionLabel}>
          <Text role="bodyStrong" tone={checked ? 'primary' : 'default'}>
            {label}
          </Text>
        </View>
        {checked && (
          <Text
            role="bodyStrong"
            tone="primary"
            accessible={false}
            importantForAccessibility="no"
          >
            ✓
          </Text>
        )}
      </View>
      <Text role="caption" tone="muted">
        {valueText ?? hint}
      </Text>
    </Pressable>
  );
}

function TripPrice({
  trip,
  khrPerUsd,
}: {
  trip: Pick<Quote, 'fare' | 'vehicleType'>;
  khrPerUsd: number | null;
}) {
  const t = useT();
  const price = formatQuotePrice(trip.fare, khrPerUsd, t);
  return (
    <>
      <Text role="title">{price.primary}</Text>
      {price.approxUsd && <Text tone="muted">{price.approxUsd}</Text>}
      <Text>
        {t('driverOffer.vehicle', {
          vehicle: t(`driverApply.${trip.vehicleType}`),
        })}
      </Text>
    </>
  );
}

const useStyles = makeStyles(t => ({
  content: { gap: spacing.md },
  card: { gap: spacing.sm },
  group: { gap: spacing.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: outlineWidth,
    borderRadius: radius.md,
    minHeight: touch.min,
    minWidth: touch.min,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionLabel: { flexShrink: 1 },
  checked: { borderColor: t.colors.primary, borderWidth: mapPinBorderWidth },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
}));
