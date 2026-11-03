import { OFFER_UPDATED_EVENT, type Offer, RIDE_UPDATED_EVENT, type Ride, type RideStatus } from '@lern/contracts';
import { pushFor } from './push-message';

const [rider, driver] = ['rider-id', 'driver-id'];
const place = { lat: 11.55, lng: 104.92 };
const rideId = '5f2c1a6e-0b1d-4c3e-9a77-1f2e3d4c5b6a';
const offerId = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const ride = (status: RideStatus): Ride => ({
  id: rideId,
  status,
  version: 7,
  vehicleType: 'moto',
  pickup: place,
  dropoff: place,
  fare: { amountMinor: 500, currency: 'USD' },
});
const offer = (status: Offer['status']): Offer => ({
  id: offerId,
  rideId,
  status,
  expiresAt: '2026-11-03T10:00:15.000Z',
  distanceM: 800,
  vehicleType: 'moto',
  pickup: place,
  dropoff: place,
  fare: { amountMinor: 500, currency: 'USD' },
});
const rideEvent = (status: RideStatus) => ({ topic: RIDE_UPDATED_EVENT, recipients: [rider, driver], payload: ride(status) });
const offerEvent = (status: Offer['status']) => ({ topic: OFFER_UPDATED_EVENT, recipients: [driver], payload: offer(status) });

it('tells the driver about a new offer, until it expires', () => {
  expect(pushFor(offerEvent('pending'))).toEqual({
    recipients: [driver],
    message: {
      title: 'New ride offer',
      body: 'Open the app to respond.',
      tag: `offer:${offerId}`,
      data: { type: 'offer', rideId, offerId },
      expiresAt: '2026-11-03T10:00:15.000Z',
    },
  });
});

it.each(['accepted', 'declined', 'expired', 'cancelled'] as const)('stays quiet about a %s offer', (status) => {
  expect(pushFor(offerEvent(status))).toBeNull();
});

// The driver pressed "arrived" themselves, maybe with navigation in front: "your driver has arrived" isn't for them
it('tells only the rider that the driver arrived', () => {
  expect(pushFor(rideEvent('driver_arrived'))).toEqual({
    recipients: [rider],
    message: {
      title: 'Your driver has arrived',
      body: 'Head to your pickup point.',
      tag: `ride:${rideId}`,
      data: { type: 'ride', rideId, seq: '7' },
    },
  });
});

it('tells everyone on the ride that it was cancelled', () => {
  expect(pushFor(rideEvent('cancelled'))).toEqual({
    recipients: [rider, driver],
    message: {
      title: 'Ride cancelled',
      body: 'Open the app for details.',
      tag: `ride:${rideId}`,
      data: { type: 'ride', rideId, seq: '7' },
    },
  });
});

it.each(['searching', 'driver_assigned', 'in_progress', 'completed', 'no_driver_found'] as const)(
  'stays quiet when a ride becomes %s',
  (status) => {
    expect(pushFor(rideEvent(status))).toBeNull();
  },
);

it.each([
  ['a malformed ride payload', { topic: RIDE_UPDATED_EVENT, recipients: [rider], payload: { sentinel: true } }],
  ['a malformed offer payload', { topic: OFFER_UPDATED_EVENT, recipients: [driver], payload: null }],
  ['another topic', { topic: 'driver:connectivity', recipients: [rider], payload: {} }],
])('ignores %s without throwing, since a throw would block the outbox', (_, event) => {
  expect(pushFor(event)).toBeNull();
});

it('sends nothing to Google that says where anyone is going or what it costs', () => {
  for (const event of [offerEvent('pending'), rideEvent('driver_arrived'), rideEvent('cancelled')]) {
    expect(JSON.stringify(pushFor(event))).not.toMatch(/pickup"|dropoff|fare|amountMinor|lat|lng/);
  }
});
