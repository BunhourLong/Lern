import { offerSchema, type Ride, rideSchema } from '@lern/contracts';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import type { StringKey } from '../../i18n';
import { ApiError } from '../../services/api.service';
import type { Permission } from '../../services/location.service';
import type { QueuedStep } from '../../services/offline-queue.service';
import type { createActiveRideStore } from '../../stores/active-ride.store';
import type { createConnectionStore } from '../../stores/connection.store';
import type { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusScreen, {
  type DriverHomeOffer,
  type DriverHomeRide,
  type OfferAction,
} from './DriverStatusScreen';
import {
  canDriverCancel,
  type DriverCancelReason,
  type DriverStepAction,
  isActiveDriverRide,
  nextDriverStep,
} from './driver-ride';

export type DriverStatusActions = Pick<
  Core,
  'setOnline' | 'refreshAvailability' | 'accept' | 'decline' | 'step' | 'cancel'
> & {
  driverMode: ReturnType<typeof createDriverModeStore>;
  connection: ReturnType<typeof createConnectionStore>;
  activeRide: ReturnType<typeof createActiveRideStore>;
  pendingSteps: () => readonly QueuedStep[];
  subscribePendingSteps?: Core['queue']['subscribeSteps'];
  requestLocationPermission: () => Promise<Permission>;
  refreshLocationPermission: () => void;
};

function remainingOfferSeconds(expiresAt: string, now: number) {
  // shortcut: The device clock may be skewed. Use server time when it is sent.
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

function rideScope(ride: Ride | null) {
  return ride ? `${ride.id}:${ride.status}` : undefined;
}

export default function DriverStatusContainer({
  driverMode,
  connection,
  activeRide,
  accept,
  decline,
  step,
  cancel,
  pendingSteps,
  subscribePendingSteps,
  now = Date.now,
  requestLocationPermission,
  refreshLocationPermission,
  setOnline,
  refreshAvailability,
  onDebug,
  edges,
}: DriverStatusActions & {
  onDebug?: () => void;
  edges?: Edge[];
  now?: () => number;
}) {
  const verification = useStore(driverMode, state => state.verification);
  const availability = useStore(driverMode, state => state.availability);
  const permission = useStore(driverMode, state => state.locationPermission);
  const connected = useStore(connection, state => state.connected);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey>();

  const offer = useStore(activeRide, state => state.offer);
  const driverRide = useStore(activeRide, state => state.driver);
  const driverPosition = useStore(driverMode, state => state.position);
  const currentRideScope = rideScope(driverRide);
  const activeDriverRide = driverRide && isActiveDriverRide(driverRide.status);
  const rideInFlight = useRef(false);
  const [rideBusy, setRideBusy] = useState<{
    scope: string;
    command: 'step' | 'cancel';
  }>();
  const [stepError, setStepError] = useState<{
    scope: string;
    key: StringKey;
  }>();
  const [cancelPanel, setCancelPanel] = useState<{
    scope: string;
    reason?: DriverCancelReason;
    error?: StringKey;
  }>();
  const [dismissedRideIds, setDismissedRideIds] = useState(
    () => new Set<string>(),
  );
  const [, tickQueue] = useReducer(revision => revision + 1, 0);
  useEffect(() => {
    const unsubscribe = subscribePendingSteps?.(tickQueue);
    if (unsubscribe) tickQueue();
    return unsubscribe;
  }, [subscribePendingSteps, tickQueue]);

  useEffect(() => {
    setStepError(issue =>
      issue?.scope === currentRideScope ? issue : undefined,
    );
    setCancelPanel(panel =>
      panel?.scope === currentRideScope ? panel : undefined,
    );
  }, [currentRideScope]);

  const offerInFlight = useRef(false);
  const [offerBusy, setOfferBusy] = useState<{
    id: string;
    action: OfferAction;
  }>();
  const [offerIssue, setOfferIssue] = useState<{
    id: string;
    reason: 'unavailable' | 'connection' | 'generic';
  }>();
  const [dismissedOfferIds, setDismissedOfferIds] = useState(
    () => new Set<string>(),
  );
  const [, tickOffer] = useReducer(tick => tick + 1, 0);
  const issue =
    offerIssue && offerIssue.id === offer?.id ? offerIssue.reason : undefined;
  let homeOffer: DriverHomeOffer | undefined;
  if (
    verification === 'verified' &&
    offer &&
    !dismissedOfferIds.has(offer.id) &&
    (!activeDriverRide || driverRide?.id === offer.rideId)
  ) {
    const { id, status } = offer;
    if (driverRide?.id === offer.rideId) {
      homeOffer = { id, status: 'accepted' };
    } else if (status === 'declined' || status === 'expired') {
      homeOffer = { id, status };
    } else if (status !== 'pending' || issue === 'unavailable') {
      homeOffer = { id, status: 'unavailable' };
    } else {
      const seconds = remainingOfferSeconds(offer.expiresAt, now());
      homeOffer =
        seconds > 0
          ? {
              id,
              status,
              details: offer,
              seconds,
              disabled: !connected || offerBusy !== undefined,
              busy: offerBusy?.id === id ? offerBusy.action : undefined,
              error: issue && `driverStatus.error.${issue}`,
            }
          : { id, status: 'expired' };
    }
  }
  const countingDown = homeOffer?.status === 'pending';
  useEffect(() => {
    if (!countingDown) return;
    const timer = setInterval(tickOffer, 1000);
    return () => clearInterval(timer);
  }, [countingDown, offer?.id, offer?.expiresAt, now]);

  useEffect(
    () => () => {
      inFlight.current = false;
    },
    [],
  );
  useEffect(() => {
    if (verification !== 'verified') return;
    refreshLocationPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshLocationPermission();
    });
    return () => subscription.remove();
  }, [verification, refreshLocationPermission]);

  const toggle = async () => {
    const state = driverMode.getState();
    const online = availability === 'offline';
    if (
      inFlight.current ||
      !connection.getState().connected ||
      state.verification !== 'verified' ||
      state.availability !== availability ||
      (!online && availability !== 'available')
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (online) {
        const result = await requestLocationPermission();
        const latest = driverMode.getState();
        if (
          !inFlight.current ||
          latest.verification !== 'verified' ||
          latest.availability !== 'offline'
        )
          return;
        driverMode.setState({ locationPermission: result });
        if (result === 'denied' || !connection.getState().connected) return;
      }
      await setOnline(online);
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : undefined;
      switch (status) {
        case 409:
          await refreshAvailability();
          break;
        case 0:
          setError('driverStatus.error.connection');
          break;
        case 403:
          setError('driverStatus.error.forbidden');
          break;
        default:
          setError('driverStatus.error.generic');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const respondToOffer = async (id: string, action: OfferAction) => {
    const { offer: latest, driver } = activeRide.getState();
    if (
      offerInFlight.current ||
      !connection.getState().connected ||
      driverMode.getState().verification !== 'verified' ||
      latest?.id !== id ||
      latest.status !== 'pending' ||
      (driver &&
        (driver.id === latest.rideId || isActiveDriverRide(driver.status))) ||
      remainingOfferSeconds(latest.expiresAt, now()) === 0
    )
      return;

    offerInFlight.current = true;
    setOfferBusy({ id, action });
    setOfferIssue(undefined);
    try {
      await (action === 'accept' ? accept(id) : decline(id));
    } catch (cause) {
      if (activeRide.getState().offer?.id !== id) return;
      const status = cause instanceof ApiError ? cause.status : undefined;
      const body = cause instanceof ApiError ? cause.body : undefined;
      if (
        status === 409 &&
        body &&
        typeof body === 'object' &&
        'offer' in body
      ) {
        const current = offerSchema.safeParse(body.offer);
        if (current.success) {
          if (current.data.status === 'pending') {
            setOfferIssue({ id, reason: 'unavailable' });
          } else {
            activeRide.getState().applyOffer(current.data);
          }
          return;
        }
      }
      setOfferIssue({
        id,
        reason:
          status === 404
            ? 'unavailable'
            : status === 0
            ? 'connection'
            : 'generic',
      });
    } finally {
      offerInFlight.current = false;
      setOfferBusy(undefined);
    }
  };

  const runStep = async (id: string, action: DriverStepAction) => {
    const latest = activeRide.getState().driver;
    const scope = rideScope(latest);
    const alreadyQueued = () =>
      pendingSteps().some(item => item.rideId === id && item.action === action);
    if (
      rideInFlight.current ||
      !scope ||
      latest?.id !== id ||
      driverMode.getState().verification === null ||
      nextDriverStep(latest.status) !== action ||
      alreadyQueued()
    )
      return;

    rideInFlight.current = true;
    setRideBusy({ scope, command: 'step' });
    setStepError(undefined);
    try {
      await step(id, action);
      if (rideScope(activeRide.getState().driver) === scope && !alreadyQueued())
        setStepError({ scope, key: 'driverStatus.error.generic' });
    } catch (cause) {
      if (rideScope(activeRide.getState().driver) === scope) {
        setStepError({
          scope,
          key:
            cause instanceof ApiError && cause.status === 0
              ? 'driverStatus.error.connection'
              : 'driverStatus.error.generic',
        });
      }
    } finally {
      rideInFlight.current = false;
      setRideBusy(undefined);
      tickQueue();
    }
  };

  const confirmCancel = async (
    id: string,
    scope: string,
    reason?: DriverCancelReason,
  ) => {
    const latest = activeRide.getState().driver;
    if (
      rideInFlight.current ||
      !connection.getState().connected ||
      !reason ||
      latest?.id !== id ||
      rideScope(latest) !== scope ||
      driverMode.getState().verification === null ||
      !canDriverCancel(latest.status) ||
      pendingSteps().some(item => item.rideId === id)
    )
      return;

    rideInFlight.current = true;
    setRideBusy({ scope, command: 'cancel' });
    setCancelPanel({ scope, reason });
    try {
      await cancel(id, reason);
      setCancelPanel(undefined);
    } catch (cause) {
      const state = activeRide.getState();
      if (state.driver?.id !== id) return;
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
          state.applyRide(parsed.data, 'driver');
          setCancelPanel(undefined);
          return;
        }
      }
      if (rideScope(state.driver) === scope) {
        const cancelError =
          status === 404
            ? 'driverRide.error.unavailable'
            : status === 0
            ? 'driverStatus.error.connection'
            : 'driverStatus.error.generic';
        setCancelPanel({ scope, reason, error: cancelError });
      }
    } finally {
      rideInFlight.current = false;
      setRideBusy(undefined);
    }
  };

  let homeRide: DriverHomeRide | undefined;
  if (
    verification !== null &&
    driverRide &&
    currentRideScope &&
    !dismissedRideIds.has(driverRide.id)
  ) {
    const { id, status, fare, vehicleType, pickup, dropoff } = driverRide;
    const summary = { id, fare, vehicleType };
    const action = nextDriverStep(status);
    if (isActiveDriverRide(status) && action) {
      const pending = pendingSteps().filter(item => item.rideId === id);
      const queued = pending.some(item => item.action === action);
      const currentCommand =
        rideBusy?.scope === currentRideScope ? rideBusy.command : undefined;
      const panel =
        cancelPanel?.scope === currentRideScope ? cancelPanel : undefined;
      homeRide = {
        ...summary,
        variant: 'active',
        status,
        pickup,
        dropoff,
        driverPosition,
        queuedNotice: queued && currentCommand !== 'step',
        step: {
          action,
          disabled: queued || Boolean(rideBusy),
          loading: currentCommand === 'step',
          error:
            stepError?.scope === currentRideScope ? stepError.key : undefined,
          onPress: () => runStep(id, action),
        },
        cancel: canDriverCancel(status)
          ? {
              open: Boolean(panel),
              disabled: !connected || Boolean(rideBusy) || pending.length > 0,
              loading: currentCommand === 'cancel',
              selected: panel?.reason,
              error: panel?.error,
              onOpen: () => setCancelPanel({ scope: currentRideScope }),
              onKeep: () => setCancelPanel(undefined),
              onSelect: reason =>
                setCancelPanel({ scope: currentRideScope, reason }),
              onConfirm: () =>
                confirmCancel(id, currentRideScope, panel?.reason),
            }
          : undefined,
      };
    } else if (status === 'completed' || status === 'cancelled') {
      homeRide = {
        ...summary,
        variant: 'ended',
        status,
        onDismiss: () => setDismissedRideIds(ids => new Set(ids).add(id)),
      };
    }
  }

  const locationNotice =
    permission === 'foreground'
      ? 'warning'
      : permission === 'denied' || permission === 'failed'
      ? 'danger'
      : undefined;
  return (
    <DriverStatusScreen
      verification={verification}
      availability={availability}
      connected={connected}
      busy={busy}
      error={error}
      locationNotice={locationNotice}
      onToggle={toggle}
      onOpenSettings={() => {
        Linking.openSettings().catch(() => undefined);
      }}
      onDebug={onDebug}
      edges={edges}
      offer={homeOffer}
      ride={homeRide}
      onOfferAction={respondToOffer}
      onDismissOffer={id => setDismissedOfferIds(ids => new Set(ids).add(id))}
    />
  );
}
