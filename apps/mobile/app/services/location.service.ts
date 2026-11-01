import type { LocationPoint } from '@lern/contracts';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import {
  type Mode,
  REPORT_EVERY_MS,
  startTracking,
  track,
} from '../utils/tracking-mode';

// Background location for an online driver (PLAN.md M5 spike, expo-location chosen 2026-11-01): an Android
// foreground service / iOS "Always" + location background mode, with a moving and a stationary profile.

export const LOCATION_TASK = 'lern.driver-location';
export type Permission = 'always' | 'foreground' | 'denied';

type Fixes = (locations: Location.LocationObject[]) => Promise<void>;
let receiver: Fixes | undefined;

// TaskManager requires tasks defined at module top level (the OS can call the task before any component mounts).
// It forwards to the running service; none running (signed out, offline, JS not booted) = the fixes are dropped.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  // Returned: the OS keeps the background task alive until the batch is handled
  await receiver?.(
    (data as { locations: Location.LocationObject[] }).locations,
  );
});

// iOS has no time-based updates: it keeps continuous updates and saves power through accuracy; the JS throttle
// below sets the upload rate on both platforms. pausesUpdatesAutomatically would stop reporting at a red light
// and get the driver flagged stale.
const PROFILES: Record<Mode, Location.LocationTaskOptions> = {
  moving: {
    accuracy: Location.Accuracy.High,
    timeInterval: REPORT_EVERY_MS.moving,
    distanceInterval: 0,
  },
  stationary: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: REPORT_EVERY_MS.stationary,
    distanceInterval: 0,
  },
};
const COMMON: Location.LocationTaskOptions = {
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Online',
    notificationBody: 'Sharing your location with riders. Go offline to stop.',
    // The app's JS (socket, offline queue) dies with it; a service left running would collect points nobody sends
    killServiceOnDestroy: true,
  },
};
// Fixes don't arrive exactly on the interval: a stationary fix 14.9 s after the last one must still go out
const SLACK = 0.8;
const SWITCH_RETRY_MS = 60_000;

export function createLocationService(
  report: (point: LocationPoint) => Promise<void>,
) {
  let tracking = startTracking();
  let lastSentAt = -Infinity;
  let nativeMode: Mode = 'moving'; // the profile the OS is actually running
  let switchFailedAt = -Infinity;
  // Bumped by start and stop: work of an older session (a batch in flight when the driver went offline) stops
  // before its next switch or report
  let session = 0;
  // start, stop and every batch run one at a time, in order
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job);
    chain = run.catch(() => undefined);
    return run;
  };

  const begin = (mode: Mode) =>
    Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...COMMON,
      ...PROFILES[mode],
    });

  async function receive(
    locations: Location.LocationObject[],
    current: number,
  ): Promise<void> {
    for (const l of locations) {
      if (current !== session) return;
      tracking = track(tracking, {
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        speedMps: l.coords.speed,
        accuracyM: l.coords.accuracy,
        at: l.timestamp,
      });
      // Starting again under the same task name replaces its options. Android refuses that while the app is in
      // the background (no new foreground service); the JS throttle below still sets the upload rate, so the
      // driver keeps reporting and the switch is tried again a minute later
      if (
        tracking.mode !== nativeMode &&
        l.timestamp - switchFailedAt >= SWITCH_RETRY_MS
      ) {
        try {
          await begin(tracking.mode);
          nativeMode = tracking.mode;
          switchFailedAt = -Infinity;
        } catch {
          switchFailedAt = l.timestamp;
        }
        if (current !== session) return;
      }
      if (l.timestamp - lastSentAt < REPORT_EVERY_MS[tracking.mode] * SLACK)
        continue;
      lastSentAt = l.timestamp;
      await report({
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        recordedAt: new Date(l.timestamp).toISOString(),
      });
    }
  }

  const mine: Fixes = locations => {
    const current = session;
    return enqueue(() => receive(locations, current));
  };

  return {
    // Driver went online. Android needs only foreground location: a foreground service started while the app is
    // visible keeps it in the background (no ACCESS_BACKGROUND_LOCATION, no Play background-location review).
    // iOS needs Always for that; 'foreground' = tracks only while the app is open
    start(): Promise<Permission> {
      session++;
      return enqueue(async () => {
        if (!(await Location.requestForegroundPermissionsAsync()).granted)
          return 'denied';
        const always =
          Platform.OS === 'android' ||
          (await Location.requestBackgroundPermissionsAsync()).granted;
        tracking = startTracking();
        lastSentAt = -Infinity;
        switchFailedAt = -Infinity;
        receiver = mine;
        await begin('moving');
        nativeMode = 'moving';
        return always ? 'always' : 'foreground';
      });
    },
    // Takes effect for anything already queued: a switch in flight finishes first, then the updates stop
    stop(): Promise<void> {
      session++;
      if (receiver === mine) receiver = undefined;
      return enqueue(async () => {
        if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
          await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      });
    },
  };
}

export type LocationService = ReturnType<typeof createLocationService>;
