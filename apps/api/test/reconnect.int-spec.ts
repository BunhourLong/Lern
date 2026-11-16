import { type ActiveRides, type Quote, RIDE_UPDATED_EVENT, type Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { LocationService } from '../src/location/location.service';
import { MatchingService } from '../src/matching/matching.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { assign, offer } from './support/offers';

// PLAN.md M5 box 2: a client that was away reconnects (the server joins its user room at handshake), fetches the
// REST snapshot, then applies only events with seq > the snapshot's version. Events sent while it was away are
// not kept for it; one in flight as it reconnects can still arrive, and the seq rule drops it. The test proves the
// snapshot holds what was missed and that the events newer than it are exactly what came after.
// A driver who goes silent or disconnects mid-trip keeps the trip: nothing cancels or moves it.

let app: INestApplication<App>;
let url: string;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Own database: sweep, reconcile and presence scan every row
beforeAll(async () => {
  app = await bootApp({}, { DATABASE_URL: await isolatedDatabase() });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
const sockets: Socket[] = [];
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

const pickup = { lat: 11.5564, lng: 104.9282 };
const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone);
};
const book = async (rider: Actor) => {
  const trip = { pickup, dropoff: { lat: pickup.lat - 0.01, lng: pickup.lng }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
const step = (d: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(d.auth).expect(200);
const snapshot = async (a: Actor) => (await http().get('/me/active-ride').set(a.auth).expect(200)).body as ActiveRides;
const listen = async (a: Actor) => {
  const socket = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('connect_error', reject));
  const rides: Ride[] = [];
  socket.on(RIDE_UPDATED_EVENT, (r: Ride) => rides.push(r));
  const until = async (done: (seen: Ride[]) => boolean) => {
    for (const end = Date.now() + 1000; !done(rides); ) {
      if (Date.now() > end) throw new Error(`ride events so far: ${rides.map((r) => r.version).join(', ')}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { socket, rides, until };
};

it('gives a rider back what they missed through the snapshot, then only events with a higher seq', async () => {
  const [rider, driver] = [await signIn(app), await verifiedDriver()];
  const ride = await assign(app, driver, (await book(rider)).id);
  const before = await listen(rider);
  before.socket.disconnect();

  await step(driver, ride.id, 'arrive'); // v3, missed
  await step(driver, ride.id, 'start'); // v4, missed
  const after = await listen(rider);
  const { rider: held } = await snapshot(rider);
  expect(held).toMatchObject({ id: ride.id, status: 'in_progress', version: 4 });
  await step(driver, ride.id, 'complete');

  // The new socket may still get a missed event the outbox was sending as it connected (at-least-once, any order),
  // so the client rule is the snapshot plus whatever is newer than it: here exactly the completion
  await after.until((rides) => rides.some((r) => r.version === 5));
  expect(after.rides.filter((r) => r.version > held!.version).map((r) => [r.status, r.version])).toEqual([['completed', 5]]);
});

it('gives a reconnecting driver their pending offer in the snapshot, and nobody else', async () => {
  const [mine, other] = [await verifiedDriver(), await verifiedDriver()];
  const ride = await book(await signIn(app));
  const offerId = await offer(app, mine, ride.id);

  const { offer: held } = await snapshot(mine);
  expect(held).toMatchObject({ id: offerId, rideId: ride.id, status: 'pending', pickup: ride.pickup, fare: ride.fare });
  expect((await snapshot(other)).offer).toBeNull();
  await http().post(`/offers/${held!.id}/accept`).set(mine.auth).expect(200);
  expect(await snapshot(mine)).toMatchObject({ driver: { id: ride.id, status: 'driver_assigned' }, offer: null });
});

it('leaves out an offer that is already past its expiry by the database clock', async () => {
  const driver = await verifiedDriver();
  const offerId = await offer(app, driver, (await book(await signIn(app))).id);
  await db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 millisecond' WHERE id = $1`, [offerId]);
  expect((await snapshot(driver)).offer).toBeNull();
});

it('keeps the trip, its accepted offer and the driver on_trip through 10 min of driver silence and disconnect', async () => {
  const [rider, driver] = [await signIn(app), await verifiedDriver()];
  await http().post('/drivers/me/locations').set(driver.auth).send({ points: [{ ...pickup, recordedAt: new Date().toISOString() }] }).expect(200);
  const ride = await assign(app, driver, (await book(rider)).id);
  await step(driver, ride.id, 'arrive');
  const trip = (await step(driver, ride.id, 'start')).body as Ride;
  (await listen(driver)).socket.disconnect();
  await db().query(`UPDATE driver_locations SET received_at = now() - interval '10 minutes' WHERE driver_id = $1`, [driver.id]);

  await app.get(LocationService).presence(30, 300);
  await app.get(MatchingService).sweep();
  await app.get(MatchingService).reconcile();

  expect((await snapshot(rider)).rider).toEqual(trip);
  const [{ availability }] = await db().query<{ availability: string }[]>('SELECT availability FROM drivers WHERE user_id = $1', [
    driver.id,
  ]);
  expect(availability).toBe('on_trip');
  const offers = await db().query<{ status: string }[]>('SELECT status FROM ride_offers WHERE ride_id = $1', [ride.id]);
  expect(offers).toEqual([{ status: 'accepted' }]);
});
