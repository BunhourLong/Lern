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

it('forgets everything on reset (sign-out)', () => {
  const store = createActiveRideStore();
  store.getState().applyRide(ride('a', 2), 'rider');
  store.getState().applyOffer(offer('o', 'b'));
  store.getState().reset();
  expect(store.getState()).toMatchObject({
    rider: null,
    driver: null,
    offer: null,
    position: null,
    connectivity: null,
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
