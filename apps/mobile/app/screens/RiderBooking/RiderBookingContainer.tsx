import type { Point, Quote, VehicleType } from '@lern/contracts';
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

export type RiderBookingActions = {
  activeRide: ReturnType<typeof createActiveRideStore>;
  appConfig: ReturnType<typeof createAppConfigStore>;
  connection: ReturnType<typeof createConnectionStore>;
  quote: Core['api']['quote'];
  book: Core['book'];
  getCurrentLocation: () => Promise<CurrentLocationResult>;
};

type Action = 'quote' | 'book';

export default function RiderBookingContainer({
  activeRide,
  appConfig,
  connection,
  quote,
  book,
  getCurrentLocation,
  onDebug,
  edges,
  now = Date.now,
}: RiderBookingActions & {
  onDebug?: () => void;
  edges?: Edge[];
  now?: () => number;
}) {
  const riderRide = useStore(activeRide, state => state.rider);
  const khrPerUsd = useStore(appConfig, state => state.khrPerUsd);
  const connected = useStore(connection, state => state.connected);
  const activeStatus =
    riderRide && isActiveRiderRide(riderRide.status)
      ? riderRide.status
      : undefined;

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

  const activeRideId = activeStatus ? riderRide?.id : undefined;
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
    const ride = activeRide.getState().rider;
    return mounted.current && !(ride && isActiveRiderRide(ride.status));
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

  const screenProps = { khrPerUsd, onDebug, edges };
  if (riderRide && activeStatus)
    return (
      <RiderBookingScreen
        {...screenProps}
        activeRide={{ ...riderRide, status: activeStatus }}
      />
    );

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
