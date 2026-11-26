import type { Offer, Ride } from '@lern/contracts';
import { createActiveRideStore } from './active-ride.store';

const ride = (
  id: string,
  version: number,
  status: Ride['status'] = 'driver_assigned',
) => ({ id, version, status } as Ride);
const offer = (
  id: string,
  rideId: string,
  status: Offer['status'] = 'pending',
) => ({ id, rideId, status } as Offer);
const at = (s: number) =>
  new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();

it('keeps the rider’s ride at its highest version, whatever order the events come in', () => {
  const store = createActiveRideStore();
  const { applyRide } = store.getState();
  applyRide(ride('a', 1, 'searching'), 'rider');
  applyRide(ride('a', 3, 'driver_arrived'));
  applyRide(ride('a', 2));
  applyRide(ride('a', 3, 'driver_arrived'));
  expect(store.getState().rider).toEqual(ride('a', 3, 'driver_arrived'));
});

it('puts an event for the ride of the held offer on the driver side, any other unknown ride on the rider side', () => {
  const store = createActiveRideStore();
  store.getState().applyOffer(offer('o', 'b'));
  store.getState().applyRide(ride('b', 2));
  store.getState().applyRide(ride('c', 1, 'searching'));
  expect([store.getState().driver?.id, store.getState().rider?.id]).toEqual([
    'b',
    'c',
  ]);
});

it('takes the snapshot on reconnect, unless it holds a newer version of the same ride already', () => {
  const store = createActiveRideStore();
  store.getState().applyRide(ride('a', 2), 'rider');
  store.getState().applySnapshot({
    rider: ride('a', 4, 'in_progress'),
    driver: null,
    offer: offer('o', 'b'),
  });
  expect(store.getState()).toMatchObject({
    rider: ride('a', 4, 'in_progress'),
    offer: offer('o', 'b'),
  });

  store.getState().applyRide(ride('a', 5, 'completed'));
  store.getState().applySnapshot({
    rider: ride('a', 4, 'in_progress'),
    driver: null,
    offer: null,
  });
  expect(store.getState()).toMatchObject({
    rider: ride('a', 5, 'completed'),
    offer: null,
  });
});

it('drops what the snapshot no longer has: the ride ended while the app was away', () => {
  const store = createActiveRideStore();
  store.getState().applyRide(ride('a', 4, 'in_progress'), 'rider');
  store.getState().applySnapshot({ rider: null, driver: null });
  expect(store.getState().rider).toBeNull();
});

it.each(['completed', 'cancelled', 'no_driver_found'] as const)(
  'keeps a %s rider ride through reconnect until dismissed',
  status => {
    const store = createActiveRideStore();
    const s = store.getState;
    const ended = ride('a', 4, status);
    s().applyRide(ended, 'rider');
    s().applySnapshot({ rider: null, driver: null });
    expect(s().rider).toEqual(ended);

    s().dismissRiderRide('a');
    expect(s().dismissedRiderIds).toEqual(new Set(['a']));
    s().applySnapshot({ rider: null, driver: null });
    expect(s().rider).toBeNull();
  },
);

it('only dismisses the current ended rider ride', () => {
  const store = createActiveRideStore();
  const s = store.getState;
  expect(s().dismissRiderRide).toEqual(expect.any(Function));
  s().applyRide(ride('a', 2), 'rider');
  s().dismissRiderRide('a');
  s().applyRide(ride('a', 3, 'completed'), 'rider');
  s().dismissRiderRide('other');
  expect(s().dismissedRiderIds).toEqual(new Set());
});

it('keeps offers by their status rules and lets the snapshot replace an offer it no longer holds', () => {
  const store = createActiveRideStore();
  store.getState().applyOffer(offer('o', 'b'));
  store.getState().applyOffer(offer('o', 'b', 'expired'));
  store.getState().applyOffer(offer('o', 'b'));
  expect(store.getState().offer?.status).toBe('expired');
  store
    .getState()
    .applySnapshot({ rider: null, driver: null, offer: offer('p', 'c') });
  expect(store.getState().offer).toEqual(offer('p', 'c'));
});

it('keeps the newest driver position and connectivity for the rider’s current ride only', () => {
  const store = createActiveRideStore();
  const s = () => store.getState();
  s().applyRide(ride('a', 2), 'rider');
  s().applyPosition({ rideId: 'a', lat: 11.5, lng: 104.9, recordedAt: at(2) });
  s().applyPosition({ rideId: 'a', lat: 11.6, lng: 104.9, recordedAt: at(1) });
  s().applyPosition({ rideId: 'other', lat: 12, lng: 105, recordedAt: at(9) });
  s().applyConnectivity({ rideId: 'a', stale: false, lastSeenAt: at(5) });
  s().applyConnectivity({ rideId: 'a', stale: true, lastSeenAt: at(4) });
  expect([s().position?.lat, s().connectivity?.stale]).toEqual([11.5, false]);

  s().applyRide(ride('a', 6, 'completed'));
  s().applyRide(ride('n', 1, 'searching'), 'rider');
  expect([s().position, s().connectivity]).toEqual([null, null]); // a new ride starts with no driver on the map
});

it('clears stale connectivity only when a newer position for the current ride arrives', () => {
  const store = createActiveRideStore();
  const s = store.getState;
  const current = ride('a', 2);
  const position = { rideId: 'a', lat: 11.5, lng: 104.9, recordedAt: at(2) };
  const stale = { rideId: 'a', stale: true, lastSeenAt: at(10) };
  s().applyRide(current, 'rider');
  s().applyPosition(position);
  s().applyConnectivity(stale);
  s().applySnapshot({ rider: current, driver: null });
  expect(s().connectivity).toEqual(stale);

  for (const ignored of [
    { ...position, lat: 11.6 },
    { ...position, recordedAt: at(1) },
    { ...position, rideId: 'other', recordedAt: at(12) },
  ]) {
    s().applyPosition(ignored);
    expect(s().position).toEqual(position);
    expect(s().connectivity).toEqual(stale);
  }

  const newer = { ...position, recordedAt: at(3) };
  s().applyPosition(newer);
  expect(s().position).toEqual(newer);
  expect(s().connectivity).toEqual({ ...stale, stale: false });

  const staleAgain = { ...stale, lastSeenAt: at(11) };
  s().applyConnectivity(staleAgain);
  expect(s().connectivity).toEqual(staleAgain);
});

it('forgets everything on reset (sign-out)', () => {
  const store = createActiveRideStore();
  store.getState().applyRide(ride('a', 2, 'completed'), 'rider');
  expect(store.getState().dismissRiderRide).toEqual(expect.any(Function));
  store.getState().dismissRiderRide('a');
  store.getState().applyOffer(offer('o', 'b'));
  store.getState().reset();
  expect(store.getState()).toMatchObject({
    rider: null,
    driver: null,
    offer: null,
    position: null,
    connectivity: null,
    dismissedRiderIds: new Set(),
  });
});

it('takes a command response for another ride even when the held one never got its final event', () => {
  const store = createActiveRideStore();
  store.getState().applyRide(ride('a', 4, 'in_progress'), 'rider'); // its completion was lost
  store.getState().applyRide(ride('b', 1, 'searching'), 'rider'); // the new booking's response
  expect(store.getState().rider).toEqual(ride('b', 1, 'searching'));
  store.getState().applyRide(ride('a', 5, 'completed')); // the late event of the old ride
  expect(store.getState().rider).toEqual(ride('b', 1, 'searching'));
});
