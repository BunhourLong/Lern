import { syncStatus } from './sync-status';

test.each([
  [false, false, false, 'offline'],
  [false, false, true, 'offline'],
  [false, true, false, 'offline'],
  [false, true, true, 'offline'],
  [true, false, false, 'ok'],
  [true, false, true, 'ok'],
  [true, true, false, 'reconnecting'],
  [true, true, true, 'ok'],
  [null, false, false, 'ok'],
  [null, false, true, 'ok'],
  [null, true, false, 'reconnecting'],
  [null, true, true, 'ok'],
] as const)(
  'network %s, signed in %s, socket connected %s → %s',
  (network, signedIn, socketConnected, expected) => {
    expect(syncStatus({ network, signedIn, socketConnected })).toBe(expected);
  },
);
