import NetInfo from '@react-native-community/netinfo';
import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import {
  createLocationService,
  getLocationPermission,
  type Permission,
} from '../services/location.service';
import { firebasePush } from '../services/firebase-push.service';
import { expoPinHasher } from '../services/pin-hasher.service';
import { keychainSecret, mmkvStore } from '../services/storage.service';
import { createCore } from './core';
import { followDeviceLanguage } from './device-language';
import { followAvailability, isDriverOnline } from './driver-location';

// The native composition: only App.tsx imports this (MMKV, Keychain and Firebase need a device or simulator)
// shortcut: simulator/emulator only, move to environments/ when a physical device or a real build needs it
const baseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

// The app only reads device connectivity, so skip HTTP reachability probes.
NetInfo.configure({ reachabilityShouldRun: () => false });

export const core = createCore({
  baseUrl,
  fetch: globalThis.fetch,
  io,
  kv: mmkvStore('lern'),
  deviceLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  refreshToken: keychainSecret('lern.session'),
  pin: keychainSecret('lern.pin'),
  pinHasher: expoPinHasher,
  // Hermes has a monotonic performance.now(); RN 0.88's types don't declare the global
  elapsed: () =>
    (
      globalThis as unknown as { performance: { now(): number } }
    ).performance.now(),
  push: firebasePush(),
  // shortcut: must match versionName (android/app/build.gradle) and MARKETING_VERSION (Lern.xcodeproj); read it with expo-application once there is a release pipeline
  appVersion: '1.0',
});

export const requestLocationPermission = () => getLocationPermission('request');

function applyLocationPermission(locationPermission: Permission | 'failed') {
  const { driverMode, rawEvents } = core.stores;
  driverMode.setState({ locationPermission });
  if (
    (locationPermission === 'denied' || locationPermission === 'failed') &&
    isDriverOnline(driverMode.getState().availability)
  ) {
    core
      .setOnline(false)
      .catch(error =>
        rawEvents.getState().add('location.offline.error', String(error)),
      );
  }
}

export async function refreshLocationPermission() {
  const { driverMode, session, rawEvents } = core.stores;
  const current = driverMode.getState().locationPermission;
  if (current === null || current === 'failed') return;
  const user = session.getState().me;
  try {
    const permission = await getLocationPermission('check');
    const state = driverMode.getState();
    if (
      session.getState().me === user &&
      state.verification === 'verified' &&
      state.locationPermission === current &&
      permission !== current
    )
      applyLocationPermission(permission);
  } catch (error) {
    rawEvents.getState().add('location.permission.error', String(error));
  }
}

// Returns the unsubscribe for useEffect. Failures go in the raw log so the screen shows them.
export function startApp(): () => void {
  const log = core.stores.rawEvents.getState().add;
  let watchingNetwork = true;
  const unwatchNetwork = NetInfo.addEventListener(({ isConnected }) => {
    // NetInfo's initial asynchronous delivery can arrive after unsubscribe.
    if (watchingNetwork)
      core.stores.connection.getState().setNetwork(isConnected);
  });
  const unfollowAvailability = followAvailability(
    core.stores.driverMode,
    createLocationService(core.reportPosition),
    (result, current) => {
      if (!current) return;
      log('location.start', result);
      applyLocationPermission(result);
    },
  );
  const unfollowDeviceLanguage = followDeviceLanguage(core.stores.language);
  core.boot().catch(err => log('boot.error', String(err)));
  return () => {
    watchingNetwork = false;
    unwatchNetwork();
    core.stopListeningForPush();
    unfollowDeviceLanguage();
    unfollowAvailability();
  };
}
