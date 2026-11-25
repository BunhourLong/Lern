import type { Me } from '@lern/contracts';
import { appGate, type AppGate } from '../stores/app-config.store';
import type { SessionState } from '../stores/session.store';
import { rootRoute } from './root-route';

const ok: AppGate = { status: 'ok' };
const update: AppGate = {
  status: 'update_required',
  storeUrl: 'https://example.com/lern',
};
const maintenance: AppGate = { status: 'maintenance' };

const restoring = { status: 'restoring', me: null } as const;
const signedOut = { status: 'signed_out', me: null } as const;
const signedIn = (
  ...roles: Me['roles']
): Pick<SessionState, 'status' | 'me'> => ({
  status: 'signed_in',
  me: { id: 'u-1', phone: '+85512345678', roles },
});
const rider = signedIn('rider');
const driver = signedIn('driver');

test.each([
  ['both stores are pending', restoring, null, 'loading'],
  ['only app config is pending', signedOut, null, 'loading'],
  ['only the session is restoring', restoring, ok, 'loading'],
  [
    'restoring takes precedence over maintenance',
    restoring,
    maintenance,
    'loading',
  ],
  ['restoring takes precedence over an update', restoring, update, 'loading'],
  ['maintenance while signed out', signedOut, maintenance, 'maintenance'],
  ['maintenance for a rider', rider, maintenance, 'maintenance'],
  ['maintenance for a driver', driver, maintenance, 'maintenance'],
  ['update while signed out', signedOut, update, 'update'],
  ['update while signed in', driver, update, 'update'],
  ['signed out', signedOut, ok, 'login'],
  ['driver only', driver, ok, 'driver'],
  ['both roles', signedIn('rider', 'driver'), ok, 'driver'],
  ['rider only', rider, ok, 'rider'],
  ['no roles', signedIn(), ok, 'rider'],
] as const)(
  '%s routes to the expected screen',
  (_name, session, gate, expected) => {
    expect(rootRoute(session, gate)).toBe(expected);
  },
);

test('routes to maintenance when app config also requires an update', () => {
  const gate = appGate(
    {
      maintenance: true,
      khrPerUsd: 4000,
      ios: { minVersion: '2.0', storeUrl: update.storeUrl },
      android: null,
    },
    'ios',
    '1.0',
  );
  expect(rootRoute(signedOut, gate)).toBe('maintenance');
});
