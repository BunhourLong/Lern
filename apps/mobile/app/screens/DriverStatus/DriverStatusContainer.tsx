import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { Core } from '../../boot/core';
import type { StringKey } from '../../i18n';
import { ApiError } from '../../services/api.service';
import type { Permission } from '../../services/location.service';
import type { createConnectionStore } from '../../stores/connection.store';
import type { createDriverModeStore } from '../../stores/driver-mode.store';
import DriverStatusScreen from './DriverStatusScreen';

export type DriverStatusActions = Pick<
  Core,
  'setOnline' | 'refreshAvailability'
> & {
  driverMode: ReturnType<typeof createDriverModeStore>;
  connection: ReturnType<typeof createConnectionStore>;
  requestLocationPermission: () => Promise<Permission>;
  refreshLocationPermission: () => void;
};

export default function DriverStatusContainer({
  driverMode,
  connection,
  requestLocationPermission,
  refreshLocationPermission,
  setOnline,
  refreshAvailability,
  onDebug,
  edges,
}: DriverStatusActions & {
  onDebug?: () => void;
  edges?: Edge[];
}) {
  const verification = useStore(driverMode, state => state.verification);
  const availability = useStore(driverMode, state => state.availability);
  const permission = useStore(driverMode, state => state.locationPermission);
  const connected = useStore(connection, state => state.connected);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey>();

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
    />
  );
}
