import type { DriverAvailability } from '@lern/contracts';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { followAvailability } from './driver-location';

const settle = () =>
  new Promise<void>(resolve => setImmediate(() => resolve()));

it('tracks while the server says the driver is online, and stops when offline or signed out', async () => {
  const store = createDriverModeStore();
  const calls: string[] = [];
  const location = {
    start: jest.fn(async () => {
      calls.push('start');
      return 'always' as const;
    }),
    stop: jest.fn(async () => {
      calls.push('stop');
    }),
  };
  const onPermission = jest.fn();
  const unfollow = followAvailability(store, location, onPermission);
  const set = async (a: DriverAvailability | null) => {
    store.getState().setAvailability(a);
    await settle();
  };

  await set('available');
  await set('reserved'); // holding an offer: still online
  await set('on_trip');
  await set('offline'); // went offline, or the presence sweep timed them out
  await set(null); // signed out
  await set('available');
  expect(calls).toEqual(['stop', 'start', 'stop', 'start']); // the first stop: boot cleanup
  expect(onPermission).toHaveBeenCalledWith('always');

  unfollow();
  await set('offline');
  expect(calls).toEqual(['stop', 'start', 'stop', 'start']);
});

it('stops any tracking left from a previous run at boot, and retries a start that failed or was denied', async () => {
  const store = createDriverModeStore();
  const answers: (() => Promise<'always' | 'denied'>)[] = [
    async () => {
      throw new Error('permission API failed');
    },
    async () => 'denied',
    async () => 'always',
  ];
  const location = {
    start: jest.fn(() => answers.shift()!()),
    stop: jest.fn(async () => undefined),
  };
  const onStart = jest.fn();
  followAvailability(store, location, onStart);
  await settle();
  expect(location.stop).toHaveBeenCalledTimes(1); // availability unknown at boot: make sure nothing runs

  for (const a of ['available', 'reserved', 'on_trip'] as const) {
    store.getState().setAvailability(a);
    await settle();
  }
  expect(onStart.mock.calls.map(([r]) => r)).toEqual([
    'failed',
    'denied',
    'always',
  ]);
  expect(location.start).toHaveBeenCalledTimes(3);
});

it('still stops for a later offline when an older start fails after newer changes were queued', async () => {
  const store = createDriverModeStore();
  let failFirst!: () => void;
  const calls: string[] = [];
  const location = {
    start: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirst = () => reject(new Error('permission API failed'));
          }),
      )
      .mockImplementation(async () => {
        calls.push('start');
        return 'always' as const;
      }),
    stop: jest.fn(async () => {
      calls.push('stop');
    }),
  };
  followAvailability(store, location, jest.fn());
  await settle();
  store.getState().setAvailability('available'); // start A: hangs, then fails
  await settle();
  store.getState().setAvailability('offline'); // queued behind A
  store.getState().setAvailability('available'); // start B, queued
  failFirst();
  await settle();
  store.getState().setAvailability('offline'); // must stop what B started
  await settle();
  expect(calls.slice(-2)).toEqual(['start', 'stop']);
});
