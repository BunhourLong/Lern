import { offerSchema } from '@lern/contracts';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import type { StringKey } from '../../i18n';
import { ApiError } from '../../services/api.service';
import type { Permission } from '../../services/location.service';
import type { createActiveRideStore } from '../../stores/active-ride.store';
import type { createConnectionStore } from '../../stores/connection.store';
import type { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusScreen, {
  type DriverHomeOffer,
  type OfferAction,
} from './DriverStatusScreen';

export type DriverStatusActions = Pick<
  Core,
  'setOnline' | 'refreshAvailability' | 'accept' | 'decline'
> & {
  driverMode: ReturnType<typeof createDriverModeStore>;
  connection: ReturnType<typeof createConnectionStore>;
  activeRide: ReturnType<typeof createActiveRideStore>;
  requestLocationPermission: () => Promise<Permission>;
  refreshLocationPermission: () => void;
};

function remainingOfferSeconds(expiresAt: string, now: number) {
  // shortcut: The device clock may be skewed. Use server time when it is sent.
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export default function DriverStatusContainer({
  driverMode,
  connection,
  activeRide,
  accept,
  decline,
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
  const driverRideId = useStore(activeRide, state => state.driver?.id);
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
    !dismissedOfferIds.has(offer.id)
  ) {
    const { id, status } = offer;
    if (driverRideId === offer.rideId) {
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
      driver?.id === latest.rideId ||
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
      onOfferAction={respondToOffer}
      onDismissOffer={id => setDismissedOfferIds(ids => new Set(ids).add(id))}
    />
  );
}
