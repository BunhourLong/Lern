import {
  createLocationService,
  getLocationPermission,
} from '../services/location.service';
import { core, refreshLocationPermission, startApp } from './app-core';

jest.mock('../services/location.service', () => ({
  createLocationService: jest.fn(),
  getLocationPermission: jest.fn(),
}));
jest.mock('../services/firebase-push.service', () => ({
  firebasePush: jest.fn(),
}));
jest.mock('../services/pin-hasher.service', () => ({}));
jest.mock('../services/storage.service', () => ({
  keychainSecret: jest.fn(),
  mmkvStore: jest.fn(),
}));
jest.mock('./device-language', () => ({
  followDeviceLanguage: () => jest.fn(),
}));
jest.mock('./core', () => ({
  createCore: () => ({
    boot: jest.fn(async () => undefined),
    setOnline: jest.fn(async () => undefined),
    stopListeningForPush: jest.fn(),
    stores: {
      driverMode: jest
        .requireActual('../stores/driver-mode.store')
        .createDriverModeStore(),
      rawEvents: jest
        .requireActual('../stores/raw-events.store')
        .createRawEventsStore(),
      session: jest
        .requireActual('../stores/session.store')
        .createSessionStore(),
    },
  }),
}));

const driverMode = core.stores.driverMode;
const setOnline = jest.mocked(core.setOnline);
const start = jest.fn();
const stop = jest.fn(async () => undefined);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
let cleanup: () => void;

function deferPermissionDenial() {
  let deny!: () => void;
  jest.mocked(getLocationPermission).mockReturnValueOnce(
    new Promise(resolve => {
      deny = () => resolve('denied');
    }),
  );
  return deny;
}

beforeEach(() => {
  jest.clearAllMocks();
  core.stores.session.getState().signedOut();
  driverMode.setState({
    availability: 'offline',
    verification: 'verified',
    locationPermission: null,
  });
  core.stores.rawEvents.getState().reset();
  jest.mocked(createLocationService).mockReturnValue({ start, stop });
  cleanup = startApp();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test.each(['denied', 'failed'] as const)(
  'goes offline and records %s when online tracking cannot start',
  async result => {
    if (result === 'failed')
      start.mockRejectedValueOnce(new Error('tracking failed'));
    else start.mockResolvedValueOnce(result);
    driverMode.getState().setAvailability('available');
    await settle();

    expect(setOnline.mock.calls).toEqual([[false]]);
    expect(driverMode.getState().locationPermission).toBe(result);
    expect(driverMode.getState().availability).toBe('available');
    expect(start).toHaveBeenCalledTimes(1);
  },
);

test('logs a refused automatic offline request and keeps the location warning', async () => {
  start.mockResolvedValueOnce('denied');
  setOnline.mockRejectedValueOnce(new Error('offline request refused'));
  driverMode.getState().setAvailability('available');
  await settle();

  expect(core.stores.rawEvents.getState().events).toMatchObject([
    {
      event: 'location.offline.error',
      payload: 'Error: offline request refused',
    },
    { event: 'location.start', payload: 'denied' },
  ]);
  expect(driverMode.getState().locationPermission).toBe('denied');
});

test('records foreground tracking without going offline', async () => {
  start.mockResolvedValueOnce('foreground');
  driverMode.getState().setAvailability('available');
  await settle();

  expect(driverMode.getState().locationPermission).toBe('foreground');
  expect(setOnline).not.toHaveBeenCalled();
});

test('ignores the result of a tracking start completed after sign-out', async () => {
  let deny!: () => void;
  start.mockReturnValueOnce(
    new Promise(resolve => {
      deny = () => resolve('denied');
    }),
  );
  driverMode.getState().setAvailability('available');
  await settle();
  driverMode.setState({
    availability: null,
    verification: null,
    locationPermission: null,
  });
  deny();
  await settle();

  expect(driverMode.getState().locationPermission).toBeNull();
  expect(setOnline).not.toHaveBeenCalled();
});

test('clears the denial after permission is granted in Settings', async () => {
  driverMode.setState({ locationPermission: 'denied' });
  jest.mocked(getLocationPermission).mockResolvedValueOnce('always');
  await refreshLocationPermission();

  expect(getLocationPermission).toHaveBeenCalledWith('check');
  expect(driverMode.getState().locationPermission).toBe('always');
  expect(setOnline).not.toHaveBeenCalled();
});

test('requests offline if permission was revoked while tracking', async () => {
  start.mockResolvedValueOnce('always');
  driverMode.getState().setAvailability('available');
  await settle();
  jest.mocked(getLocationPermission).mockResolvedValueOnce('denied');
  await refreshLocationPermission();

  expect(driverMode.getState().locationPermission).toBe('denied');
  expect(setOnline.mock.calls).toEqual([[false]]);
});

test('records denied permission without requesting offline when already offline', async () => {
  driverMode.setState({ locationPermission: 'always' });
  jest.mocked(getLocationPermission).mockResolvedValueOnce('denied');
  await refreshLocationPermission();

  expect(driverMode.getState().locationPermission).toBe('denied');
  expect(setOnline).not.toHaveBeenCalled();
});

test.each([null, 'failed'] as const)(
  'skips the native permission check when the stored result is %s',
  async locationPermission => {
    driverMode.setState({ locationPermission });
    await refreshLocationPermission();

    expect(getLocationPermission).not.toHaveBeenCalled();
    expect(driverMode.getState().locationPermission).toBe(locationPermission);
  },
);

test('discards a permission check from a signed-out driver after another driver goes online', async () => {
  const { session } = core.stores;
  session.getState().signedIn({
    id: 'driver-1',
    phone: '+85512345678',
    roles: ['driver'],
  });
  start.mockResolvedValueOnce('always');
  driverMode.getState().setAvailability('available');
  await settle();
  const deny = deferPermissionDenial();
  const check = refreshLocationPermission();

  driverMode.setState({
    availability: null,
    verification: null,
    locationPermission: null,
  });
  session.getState().signedOut();
  session.getState().signedIn({
    id: 'driver-2',
    phone: '+85512345679',
    roles: ['driver'],
  });
  start.mockResolvedValueOnce('always');
  driverMode.setState({ availability: 'available', verification: 'verified' });
  await settle();
  deny();
  await check;

  expect(driverMode.getState().locationPermission).toBe('always');
  expect(setOnline).not.toHaveBeenCalled();
});

test('keeps a newer tracking permission when a pending check resolves', async () => {
  driverMode.setState({ locationPermission: 'always' });
  const deny = deferPermissionDenial();
  const check = refreshLocationPermission();

  start.mockResolvedValueOnce('foreground');
  driverMode.getState().setAvailability('available');
  await settle();
  deny();
  await check;

  expect(driverMode.getState().locationPermission).toBe('foreground');
  expect(setOnline).not.toHaveBeenCalled();
});

test('discards a pending permission check if verification is lost', async () => {
  driverMode.setState({ locationPermission: 'always' });
  const deny = deferPermissionDenial();
  const check = refreshLocationPermission();

  driverMode.setState({ verification: 'suspended' });
  deny();
  await check;

  expect(driverMode.getState().locationPermission).toBe('always');
  expect(setOnline).not.toHaveBeenCalled();
});
