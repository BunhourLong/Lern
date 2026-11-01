import type { LocationPoint } from '@lern/contracts';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { createLocationService, LOCATION_TASK } from './location.service';

// The native modules don't exist in Jest; the task handler is captured so the test can play the OS
let task: (body: { data?: unknown; error?: unknown }) => Promise<void>;
jest.mock('expo-task-manager', () => ({
  defineTask: (_: string, fn: typeof task) => {
    task = fn;
  },
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));
const L = Location as jest.Mocked<typeof Location>;

const loc = (s: number, speed: number) => ({
  coords: { latitude: 11.5564, longitude: 104.9282, speed, accuracy: 5 },
  timestamp: Date.UTC(2026, 10, 1, 10, 0, 0) + s * 1000,
});
const deliver = async (...locations: ReturnType<typeof loc>[]) =>
  task({ data: { locations } });

beforeEach(() => jest.clearAllMocks());

it('asks for foreground then background permission and starts the moving profile with a foreground service', async () => {
  const service = createLocationService(jest.fn(async () => undefined));
  expect(await service.start()).toBe('always');
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledWith(
    LOCATION_TASK,
    expect.objectContaining({
      accuracy: Location.Accuracy.High,
      timeInterval: 4000,
      pausesUpdatesAutomatically: false,
      foregroundService: expect.objectContaining({
        killServiceOnDestroy: true,
      }),
    }),
  );
});

it('still tracks with foreground permission only, and not at all without location permission', async () => {
  L.requestBackgroundPermissionsAsync.mockResolvedValueOnce({
    granted: false,
  } as never);
  expect(await createLocationService(jest.fn()).start()).toBe('foreground');
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({
    granted: false,
  } as never);
  expect(await createLocationService(jest.fn()).start()).toBe('denied');
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('reports at most one point per interval, in order, with the fix time as recordedAt', async () => {
  const report = jest.fn(async (_point: LocationPoint) => undefined);
  await createLocationService(report).start();
  await deliver(loc(0, 8), loc(1, 8), loc(2, 8), loc(4, 8), loc(7.5, 8));
  expect(report.mock.calls.map(([p]) => p.recordedAt)).toEqual([
    new Date(loc(0, 8).timestamp).toISOString(),
    new Date(loc(4, 8).timestamp).toISOString(),
    new Date(loc(7.5, 8).timestamp).toISOString(), // within the slack of 4 s
  ]);
});

it('switches to the stationary profile after 2 min standing still, and back when driving', async () => {
  await createLocationService(jest.fn(async () => undefined)).start();
  for (let s = 0; s <= 120; s += 15) await deliver(loc(s, 0));
  expect(L.startLocationUpdatesAsync).toHaveBeenLastCalledWith(
    LOCATION_TASK,
    expect.objectContaining({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15_000,
    }),
  );
  await deliver(loc(130, 6));
  expect(L.startLocationUpdatesAsync).toHaveBeenLastCalledWith(
    LOCATION_TASK,
    expect.objectContaining({
      accuracy: Location.Accuracy.High,
      timeInterval: 4000,
    }),
  );
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledTimes(3);
});

it('stops updates on stop, and drops what the OS still delivers afterwards', async () => {
  const report = jest.fn(async (_point: LocationPoint) => undefined);
  const service = createLocationService(report);
  await service.start();
  await service.stop();
  await deliver(loc(0, 8));
  expect(L.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK);
  expect(report).not.toHaveBeenCalled();
});

it('ignores a task call that carries an error instead of locations', async () => {
  const report = jest.fn(async (_point: LocationPoint) => undefined);
  await createLocationService(report).start();
  await task({ error: new Error('kCLErrorLocationUnknown') });
  expect(report).not.toHaveBeenCalled();
});

it('keeps reporting when the OS refuses a profile switch in the background, and retries it at most once a minute', async () => {
  const report = jest.fn(async (_point: LocationPoint) => undefined);
  await createLocationService(report).start();
  // Android: no new foreground service while the app is in the background
  L.startLocationUpdatesAsync.mockRejectedValue(
    new Error('ForegroundServiceStartNotAllowedException'),
  );
  for (let s = 0; s <= 165; s += 15) await deliver(loc(s, 0));
  const switchTries = () => L.startLocationUpdatesAsync.mock.calls.length - 1;
  expect(switchTries()).toBe(1); // at 120 s; not again before 180 s
  expect(report).toHaveBeenCalledTimes(12); // every fix still went out
  L.startLocationUpdatesAsync.mockResolvedValue(undefined);
  await deliver(loc(180, 0));
  expect(switchTries()).toBe(2);
});

it('ends stopped when stop() lands during a profile switch, and reports nothing after it', async () => {
  const report = jest.fn(async (_point: LocationPoint) => undefined);
  const service = createLocationService(report);
  await service.start();
  for (let s = 0; s <= 105; s += 15) await deliver(loc(s, 0));
  const order: string[] = [];
  let finishSwitch!: () => void;
  L.startLocationUpdatesAsync.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finishSwitch = () => {
          order.push('switched');
          resolve();
        };
      }),
  );
  L.stopLocationUpdatesAsync.mockImplementationOnce(async () => {
    order.push('stopped');
  });
  const reportsBefore = report.mock.calls.length;
  const delivering = deliver(loc(120, 0), loc(121, 0)); // 120 s: switch to stationary, then one more fix
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  const stopping = service.stop();
  finishSwitch();
  await Promise.all([delivering, stopping]);
  expect(order).toEqual(['switched', 'stopped']);
  expect(report.mock.calls.length).toBe(reportsBefore);
});

it('asks Android for foreground location only (its foreground service keeps it in the background); iOS for Always', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(await createLocationService(jest.fn()).start()).toBe('always');
  expect(L.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  await createLocationService(jest.fn()).start();
  expect(L.requestBackgroundPermissionsAsync).toHaveBeenCalled();
});
