import {
  type Point,
  type Quote,
  type Ride,
  rideSchema,
  type VehicleType,
} from '@lern/contracts';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Edge } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import type { StringKey } from '../../i18n';
import { ApiError } from '../../services/api.service';
import type { CurrentLocationResult } from '../../services/location.service';
import type { createActiveRideStore } from '../../stores/active-ride.store';
import type { createAppConfigStore } from '../../stores/app-config.store';
import type { createConnectionStore } from '../../stores/connection.store';
import { uuid } from '../../utils/uuid';
import RiderBookingScreen, {
  type BookingEndpoint,
  type PickupSource,
} from './RiderBookingScreen';
import {
  isActiveRiderRide,
  isSamePoint,
  isWithinServiceArea,
  PHNOM_PENH_PRESETS,
  type PresetId,
  remainingQuoteSeconds,
} from './rider-booking';
import {
  canRiderCancel,
  hasAssignedDriver,
  isEndedRiderRide,
  riderCancelReasons,
  type RiderCancelReason,
} from './rider-ride';

function rideScope(ride: Ride | null) {
  return ride ? `${ride.id}:${ride.status}` : undefined;
}

export type RiderBookingActions = {
  activeRide: ReturnType<typeof createActiveRideStore>;
  appConfig: ReturnType<typeof createAppConfigStore>;
  connection: ReturnType<typeof createConnectionStore>;
  quote: Core['api']['quote'];
  book: Core['book'];
  cancel: Core['cancel'];
  onOpenMap?: () => void;
  getCurrentLocation: () => Promise<CurrentLocationResult>;
};

type Action = 'quote' | 'book';

export default function RiderBookingContainer({
  activeRide,
  appConfig,
  connection,
  quote,
  book,
  cancel,
  getCurrentLocation,
  onOpenMap,
  focused,
  onDebug,
  edges,
  now = Date.now,
}: RiderBookingActions & {
  onDebug?: () => void;
  focused?: boolean;
  edges?: Edge[];
  now?: () => number;
}) {
  const riderRide = useStore(activeRide, state => state.rider);
  const khrPerUsd = useStore(appConfig, state => state.khrPerUsd);
  const connected = useStore(connection, state => state.connected);
  const driverPositionRaw = useStore(activeRide, state => state.position);
  const driverConnectivity = useStore(activeRide, state => state.connectivity);
  const dismissedRideIds = useStore(
    activeRide,
    state => state.dismissedRiderIds,
  );
  const visibleRide =
    riderRide && !dismissedRideIds.has(riderRide.id) ? riderRide : null;
  const currentRideScope = rideScope(visibleRide);
  const cancelInFlight = useRef(false);
  const [cancellingScope, setCancellingScope] = useState<string>();
  const [cancelPanel, setCancelPanel] = useState<{
    scope: string;
    reason?: RiderCancelReason;
    key?: string;
    error?: StringKey;
  }>();

  useEffect(() => {
    setCancelPanel(panel =>
      panel?.scope === currentRideScope ? panel : undefined,
    );
  }, [currentRideScope]);

  const [pickup, setPickup] = useState<Point>(PHNOM_PENH_PRESETS[0].point);
  const [pickupSource, setPickupSource] = useState<PickupSource>('preset');
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [target, setTarget] = useState<BookingEndpoint>('dropoff');
  const [vehicleType, setVehicleType] = useState<VehicleType>('moto');
  const [cameraKey, recenter] = useReducer(key => key + 1, 0);
  const [pinRevision, restorePins] = useReducer(revision => revision + 1, 0);

  const [pending, setPending] = useState<Action>();
  const inFlight = useRef<Action | undefined>(undefined);
  const mounted = useRef(false);
  const [locating, setLocating] = useState(false);
  const locateSeq = useRef(0);
  const locateActive = useRef(false);
  const quoteSeq = useRef(0);
  const [quoteState, setQuoteState] = useState<{
    quote: Quote;
    bookKey: string;
    expired: boolean;
  } | null>(null);
  const [locationError, setLocationError] = useState<StringKey>();
  const [quoteError, setQuoteError] = useState<StringKey>();
  const [bookError, setBookError] = useState<StringKey>();
  const [, tickQuote] = useReducer(tick => tick + 1, 0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      locateSeq.current += 1;
      locateActive.current = false;
    };
  }, []);

  const stopLocating = useCallback(() => {
    locateSeq.current++;
    locateActive.current = false;
    setLocating(false);
  }, []);

  const activeRideId = visibleRide?.id;
  useEffect(() => {
    if (!activeRideId) return;
    stopLocating();
    quoteSeq.current++;
    setQuoteState(null);
    setQuoteError(undefined);
    setBookError(undefined);
    setLocationError(undefined);
  }, [activeRideId, stopLocating]);

  const quoteSeconds = quoteState
    ? remainingQuoteSeconds(quoteState.quote.expiresAt, now())
    : 0;
  const quoteExpired = quoteState !== null && quoteState.expired;
  const countingDown = quoteSeconds > 0;
  useEffect(() => {
    if (!quoteState || quoteState.expired || !countingDown || activeRideId)
      return;
    const timer = setInterval(() => {
      if (remainingQuoteSeconds(quoteState.quote.expiresAt, now()) === 0)
        clearInterval(timer);
      tickQuote();
    }, 1000);
    return () => clearInterval(timer);
  }, [activeRideId, countingDown, now, quoteState]);

  const samePoint = dropoff !== null && isSamePoint(pickup, dropoff);
  const validTrip =
    dropoff !== null &&
    !samePoint &&
    isWithinServiceArea(pickup) &&
    isWithinServiceArea(dropoff);
  const busy = pending === 'book';

  function canEdit() {
    const { rider: ride, dismissedRiderIds } = activeRide.getState();
    return (
      mounted.current &&
      (!ride ||
        (!isActiveRiderRide(ride.status) && dismissedRiderIds.has(ride.id)))
    );
  }

  function canChangeSelection() {
    return canEdit() && inFlight.current !== 'book';
  }

  function startAction(action: Action) {
    inFlight.current = action;
    setPending(action);
  }

  function finishAction() {
    inFlight.current = undefined;
    if (mounted.current) setPending(undefined);
  }

  function invalidateQuote() {
    quoteSeq.current++;
    setQuoteState(null);
    setQuoteError(undefined);
    setBookError(undefined);
  }

  function changePoint(
    endpoint: BookingEndpoint,
    point: Point,
    source: PickupSource,
    dragged = false,
  ) {
    if (!isWithinServiceArea(point)) {
      setLocationError('riderBooking.error.outsideArea');
      // The native marker has already moved. Restoring its key re-applies the saved coordinate.
      if (dragged) restorePins();
      return;
    }
    const previous = endpoint === 'pickup' ? pickup : dropoff;
    if (!previous || previous.lat !== point.lat || previous.lng !== point.lng)
      invalidateQuote();
    if (endpoint === 'pickup') {
      if (source !== 'gps') stopLocating();
      setPickup(point);
      setPickupSource(source);
    } else {
      setDropoff(point);
    }
    setLocationError(undefined);
    if (source !== 'map') recenter();
  }

  function selectPreset(id: PresetId) {
    if (!canChangeSelection()) return;
    const preset = PHNOM_PENH_PRESETS.find(place => place.id === id);
    if (preset) changePoint(target, preset.point, 'preset');
  }

  function selectVehicle(next: VehicleType) {
    if (!canChangeSelection() || next === vehicleType) return;
    invalidateQuote();
    setVehicleType(next);
    setLocationError(undefined);
  }

  function selectMapPoint(
    endpoint: BookingEndpoint,
    point: Point,
    dragged = false,
  ) {
    if (canChangeSelection()) changePoint(endpoint, point, 'map', dragged);
  }

  async function useCurrentLocation() {
    if (!canChangeSelection() || locateActive.current) return;
    const seq = ++locateSeq.current;
    locateActive.current = true;
    setLocating(true);
    setLocationError(undefined);
    try {
      const result = await getCurrentLocation();
      if (!canEdit() || seq !== locateSeq.current) return;
      if (result.status === 'ok') changePoint('pickup', result.point, 'gps');
      else if (result.status === 'denied')
        setLocationError('riderBooking.error.locationDenied');
      else setLocationError('riderBooking.error.locationUnavailable');
    } catch {
      if (canEdit() && seq === locateSeq.current)
        setLocationError('riderBooking.error.locationUnavailable');
    } finally {
      if (mounted.current && seq === locateSeq.current) stopLocating();
    }
  }

  async function requestQuote() {
    if (
      !canEdit() ||
      !connection.getState().connected ||
      !dropoff ||
      !validTrip ||
      inFlight.current
    )
      return;
    const seq = ++quoteSeq.current;
    startAction('quote');
    setQuoteError(undefined);
    setBookError(undefined);
    try {
      const result = await quote({ pickup, dropoff, vehicleType });
      if (canEdit() && seq === quoteSeq.current)
        setQuoteState({
          quote: result,
          bookKey: uuid(),
          expired: false,
        });
    } catch (error) {
      if (!canEdit() || seq !== quoteSeq.current) return;
      const status = error instanceof ApiError ? error.status : undefined;
      setQuoteError(
        status === 0
          ? 'riderBooking.error.connection'
          : status === 400
          ? 'riderBooking.error.outsideArea'
          : 'riderBooking.error.quoteFailed',
      );
    } finally {
      finishAction();
    }
  }

  async function bookRide() {
    if (
      !canEdit() ||
      !connection.getState().connected ||
      !quoteState ||
      quoteState.expired ||
      inFlight.current
    )
      return;
    const { id } = quoteState.quote;
    const seq = quoteSeq.current;
    // Keep the quoted pickup available for a retry if booking fails.
    stopLocating();
    startAction('book');
    setBookError(undefined);
    try {
      await book(id, quoteState.bookKey);
      if (mounted.current && seq === quoteSeq.current) invalidateQuote();
    } catch (error) {
      if (!canEdit() || seq !== quoteSeq.current) return;
      const status = error instanceof ApiError ? error.status : undefined;
      if (status === 410 || status === 404) {
        setQuoteState(current =>
          current?.quote.id === id ? { ...current, expired: true } : current,
        );
      } else {
        setBookError(
          status === 409
            ? 'riderBooking.error.conflict'
            : status === 0
            ? 'riderBooking.error.connection'
            : 'riderBooking.error.bookFailed',
        );
      }
    } finally {
      finishAction();
    }
  }

  async function confirmCancel(
    id: string,
    scope: string,
    reason?: RiderCancelReason,
    key?: string,
  ) {
    const latest = activeRide.getState().rider;
    if (
      cancelInFlight.current ||
      !mounted.current ||
      !connection.getState().connected ||
      !reason ||
      !key ||
      latest?.id !== id ||
      rideScope(latest) !== scope ||
      !canRiderCancel(latest.status)
    )
      return;

    cancelInFlight.current = true;
    setCancellingScope(scope);
    setCancelPanel({ scope, reason, key });
    try {
      await cancel(id, reason, key);
      if (mounted.current) setCancelPanel(undefined);
    } catch (cause) {
      const state = activeRide.getState();
      const currentRide = state.rider;
      if (currentRide?.id !== id) return;
      const status = cause instanceof ApiError ? cause.status : undefined;
      const body = cause instanceof ApiError ? cause.body : undefined;
      if (
        status === 409 &&
        body &&
        typeof body === 'object' &&
        'ride' in body
      ) {
        const parsed = rideSchema.safeParse(body.ride);
        if (parsed.success && parsed.data.id === id) {
          state.applyRide(parsed.data, 'rider');
          if (mounted.current) setCancelPanel(undefined);
          return;
        }
      }
      const latestScope = rideScope(currentRide);
      if (
        mounted.current &&
        latestScope &&
        canRiderCancel(currentRide.status) &&
        riderCancelReasons(currentRide.status).includes(reason)
      ) {
        const error =
          status === 404
            ? 'riderRide.error.unavailable'
            : status === 0
            ? 'riderRide.error.connection'
            : 'riderRide.error.cancelFailed';
        setCancelPanel({ scope: latestScope, reason, key, error });
      }
    } finally {
      cancelInFlight.current = false;
      if (mounted.current) setCancellingScope(undefined);
    }
  }

  const screenProps = { khrPerUsd, onDebug, edges, focused };
  if (visibleRide && currentRideScope) {
    const { id, status } = visibleRide;
    if (isEndedRiderRide(status)) {
      return (
        <RiderBookingScreen
          {...screenProps}
          activeRide={{
            ...visibleRide,
            variant: 'ended',
            status,
            onDismiss: () => {
              if (mounted.current) activeRide.getState().dismissRiderRide(id);
            },
          }}
        />
      );
    }
    const panel =
      cancelPanel?.scope === currentRideScope ? cancelPanel : undefined;
    const showDriver = hasAssignedDriver(status);
    return (
      <RiderBookingScreen
        {...screenProps}
        activeRide={{
          ...visibleRide,
          variant: 'active',
          status,
          onOpenMap,
          driverPosition:
            showDriver && driverPositionRaw?.rideId === id
              ? driverPositionRaw
              : null,
          driverStale:
            showDriver &&
            driverConnectivity?.rideId === id &&
            driverConnectivity.stale,
          cancel: canRiderCancel(status)
            ? {
                open: Boolean(panel),
                disabled: !connected || cancellingScope !== undefined,
                loading: cancellingScope === currentRideScope,
                selected: panel?.reason,
                error: panel?.error,
                onOpen: () => {
                  if (
                    !cancelInFlight.current &&
                    rideScope(activeRide.getState().rider) === currentRideScope
                  )
                    setCancelPanel({ scope: currentRideScope });
                },
                onKeep: () => {
                  if (!cancelInFlight.current) setCancelPanel(undefined);
                },
                onSelect: reason => {
                  if (cancelInFlight.current) return;
                  setCancelPanel(prev =>
                    prev?.scope === currentRideScope
                      ? {
                          scope: currentRideScope,
                          reason,
                          key:
                            prev.reason === reason && prev.key
                              ? prev.key
                              : uuid(),
                        }
                      : prev,
                  );
                },
                onConfirm: () =>
                  confirmCancel(
                    id,
                    currentRideScope,
                    panel?.reason,
                    panel?.key,
                  ),
              }
            : undefined,
        }}
      />
    );
  }

  return (
    <RiderBookingScreen
      {...screenProps}
      booking={{
        pickup,
        pickupSource,
        dropoff,
        target,
        vehicleType,
        cameraKey,
        pinRevision,
        busy,
        samePoint,
        locationError,
        quoteError,
        bookError,
        locating,
        quoting: pending === 'quote',
        booking: pending === 'book',
        canQuote: connected && validTrip && !pending,
        canBook: connected && quoteState !== null && !quoteExpired && !pending,
        quote: quoteState
          ? {
              quote: quoteState.quote,
              seconds: quoteSeconds,
              expired: quoteExpired,
            }
          : undefined,
        onSelectTarget: next => {
          if (canChangeSelection()) setTarget(next);
        },
        onSelectPreset: selectPreset,
        onSelectVehicle: selectVehicle,
        onUseCurrentLocation: useCurrentLocation,
        onMapPress: point => selectMapPoint(target, point),
        onDragPickup: point => selectMapPoint('pickup', point, true),
        onDragDropoff: point => selectMapPoint('dropoff', point, true),
        onRequestQuote: requestQuote,
        onBook: bookRide,
      }}
    />
  );
}
