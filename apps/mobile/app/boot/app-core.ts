import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import { createLocationService } from '../services/location.service';
import { firebasePush } from '../services/firebase-push.service';
import { keychainSecret, mmkvStore } from '../services/storage.service';
import { createCore } from './core';
import { followAvailability } from './driver-location';

// The native composition: only App.tsx imports this (MMKV, Keychain and Firebase need a device or simulator)
// shortcut: simulator/emulator only, move to environments/ when a physical device or a real build needs it
const baseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const core = createCore({
  baseUrl,
  fetch: globalThis.fetch,
  io,
  kv: mmkvStore('lern'),
  refreshToken: keychainSecret('lern.session'),
  push: firebasePush(),
});

// Returns the unsubscribe for useEffect. Failures go in the raw log so the screen shows them.
export function startApp(): () => void {
  const log = core.stores.rawEvents.getState().add;
  const stop = followAvailability(
    core.stores.driverMode,
    createLocationService(core.reportPosition),
    r => log('location.start', r),
  );
  core.boot().catch(err => log('boot.error', String(err)));
  return stop;
}
