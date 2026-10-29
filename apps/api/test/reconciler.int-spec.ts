import type { Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingService } from '../src/matching/matching.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { assign, offer } from './support/offers';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const reconcile = () => app.get(MatchingService).reconcile();

// Own database: the reconciler scans every row, so each test sees only the anomaly it built
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
});
afterAll(() => app.close());

const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone);
};
const searchingRide = async () => {
  const rider = await signIn(app);
  const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  return { rider, ride };
};
const availability = async (a: Actor) =>
  (await db().query<{ availability: string }[]>('SELECT availability FROM drivers WHERE user_id = $1', [a.id]))[0]
    .availability;
const setAvailability = (a: Actor, state: string) =>
  db().query('UPDATE drivers SET availability = $2 WHERE user_id = $1', [a.id, state]);
const offerStatus = async (id: string) =>
  (await db().query<{ status: string }[]>('SELECT status FROM ride_offers WHERE id = $1', [id]))[0].status;
const none = { lostTimers: 0, staleOffers: 0, reservedWithoutOffer: 0, onTripWithoutRide: 0 };

it('finds nothing to repair in a healthy state: a driver holding an offer, a driver on a trip', async () => {
  const { ride } = await searchingRide();
  await offer(app, await verifiedDriver(), ride.id);
  await assign(app, await verifiedDriver(), (await searchingRide()).ride.id);
  expect(await reconcile()).toEqual(none);
});

it('expires an offer whose timer was lost, and frees its driver', async () => {
  const { ride } = await searchingRide();
  const d = await verifiedDriver();
  const offerId = await offer(app, d, ride.id);
  await db().query(`UPDATE ride_offers SET expires_at = now() - interval '10 seconds' WHERE id = $1`, [offerId]);

  expect(await reconcile()).toEqual({ ...none, lostTimers: 1 });
  expect(await offerStatus(offerId)).toBe('expired');
  expect(await availability(d)).toBe('available');
  expect(await reconcile()).toEqual(none);
});

it('leaves a timer a few seconds late to the timer itself', async () => {
  const { ride } = await searchingRide();
  const d = await verifiedDriver();
  const offerId = await offer(app, d, ride.id);
  await db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 second' WHERE id = $1`, [offerId]);
  expect(await reconcile()).toEqual(none);
  await app.get(MatchingService).expire(offerId); // what its timer does; leaves nothing for the next test
});

it('ends the pending offer of a ride that stopped searching', async () => {
  const { rider, ride } = await searchingRide();
  const d = await verifiedDriver();
  const offerId = await offer(app, d, ride.id);
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200); // its sync job is lost

  expect(await reconcile()).toEqual({ ...none, staleOffers: 1 });
  expect(await offerStatus(offerId)).toBe('cancelled');
  expect(await availability(d)).toBe('available');
  expect(await reconcile()).toEqual(none);
});

it('frees a driver left reserved without a pending offer', async () => {
  const d = await verifiedDriver();
  await setAvailability(d, 'reserved');
  expect(await reconcile()).toEqual({ ...none, reservedWithoutOffer: 1 });
  expect(await availability(d)).toBe('available');
  expect(await reconcile()).toEqual(none);
});

it('frees a driver left on a trip without an active ride', async () => {
  const d = await verifiedDriver();
  await setAvailability(d, 'on_trip');
  expect(await reconcile()).toEqual({ ...none, onTripWithoutRide: 1 });
  expect(await availability(d)).toBe('available');
  expect(await reconcile()).toEqual(none);
});

it('keeps repairing past an item whose repair fails', async () => {
  const { ride } = await searchingRide();
  const offerId = await offer(app, await verifiedDriver(), ride.id);
  await db().query(`UPDATE ride_offers SET expires_at = now() - interval '10 seconds' WHERE id = $1`, [offerId]);
  const stuck = await verifiedDriver();
  await setAvailability(stuck, 'on_trip');
  const service = app.get(MatchingService);
  jest.spyOn(service, 'expire').mockRejectedValueOnce(new Error('poison offer'));

  expect(await reconcile()).toMatchObject({ lostTimers: 0, onTripWithoutRide: 1 });
  expect(await availability(stuck)).toBe('available');
  jest.restoreAllMocks();
  expect(await reconcile()).toEqual({ ...none, lostTimers: 1 }); // the next run repairs it
});
