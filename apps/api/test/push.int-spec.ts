import type { Point, Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingService } from '../src/matching/matching.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushProvider } from '../src/notifications/push.provider';
import { PushQueue } from '../src/notifications/push-queue';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

let app: INestApplication<App>;
let send: jest.SpiedFunction<PushProvider['send']>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Own database: any app that drains the outbox pushes through its own queue and provider, so a shared one would hand
// this suite's events to another suite's spy
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
  send = jest.spyOn(app.get(PushProvider), 'send');
});
afterEach(() => send.mockClear());
afterAll(() => app.close());

let spots = 0;
const nextSpot = (): Point => ({ lat: 12.2 + (spots % 5) * 0.2, lng: 105.6 + Math.floor(spots++ / 5) * 0.2 });

// Registers a phone for this user and returns its token
const device = async (a: Actor) => {
  const token = `fcm-${randomUUID()}`;
  await http().put('/me/device-token').set(a.auth).send({ token, platform: 'android' }).expect(204);
  return token;
};
const dbNow = async () => (await db().query<{ t: Date }[]>('SELECT now() AS t'))[0].t.getTime();

const onlineDriver = async (at: Point) => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  const d = await signIn(app, me.phone);
  await http().put('/drivers/me/availability').set(d.auth).send({ online: true }).expect(200);
  const recordedAt = new Date((await dbNow()) - 1000).toISOString();
  await http().post('/drivers/me/locations').set(d.auth).send({ points: [{ ...at, recordedAt }] }).expect(200);
  return d;
};
const book = async (rider: Actor, pickup: Point) => {
  const trip = { pickup, dropoff: { lat: pickup.lat + 0.03, lng: pickup.lng }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
// An offer made by real matching, so it goes through the real outbox statement
const offered = async () => {
  const spot = nextSpot();
  const [rider, driver] = [await signIn(app), await onlineDriver(spot)];
  const ride = await book(rider, spot);
  await app.get(MatchingService).sync(ride.id);
  const [{ id }] = await db().query<{ id: string }[]>('SELECT id FROM ride_offers WHERE ride_id = $1', [ride.id]);
  return { rider, driver, ride, offerId: id };
};
const assigned = async () => {
  const o = await offered();
  await http().post(`/offers/${o.offerId}/accept`).set(o.driver.auth).expect(200);
  return o;
};

const sentTo = (token: string) => send.mock.calls.filter(([tokens]) => tokens.includes(token));
const until = async (done: () => boolean | Promise<boolean>, ms = 3000) => {
  for (const end = Date.now() + ms; !(await done()); ) {
    if (Date.now() > end) throw new Error(`not within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
// Other tests' jobs may still be running, so absence is checked for this test's own message only
const sentWithTag = (tag: string) => send.mock.calls.filter(([, message]) => message.tag === tag);
const pushed = async (token: string, title: string) => {
  await until(() => sentTo(token).some(([, message]) => message.title === title));
  return sentTo(token).find(([, message]) => message.title === title)!;
};

it('tells the driver about a new offer, for as long as the offer lasts', async () => {
  const spot = nextSpot();
  const driver = await onlineDriver(spot);
  const token = await device(driver);
  const ride = await book(await signIn(app), spot);
  await app.get(MatchingService).sync(ride.id);

  const [, message, window] = await pushed(token, 'New ride offer');
  const [{ id: offerId }] = await db().query<{ id: string }[]>('SELECT id FROM ride_offers WHERE ride_id = $1', [ride.id]);
  expect(message.data).toEqual({ type: 'offer', rideId: ride.id, offerId });
  expect(window.ttlMs).toBeGreaterThan(5000);
  expect(window.ttlMs).toBeLessThanOrEqual(15_000);
});

it('tells only the rider that the driver arrived', async () => {
  const { rider, driver, ride } = await assigned();
  const [riderToken, driverToken] = [await device(rider), await device(driver)];
  await http().post(`/rides/${ride.id}/arrive`).set(driver.auth).expect(200);

  const [, message, window] = await pushed(riderToken, 'Your driver has arrived');
  expect(message.data).toEqual({ type: 'ride', rideId: ride.id, seq: '3' });
  expect(window.ttlMs).toBe(600_000);

  // The cancel below is pushed after the arrival through the same queue, so the driver's turn has passed by then
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await pushed(driverToken, 'Ride cancelled');
  expect(sentTo(driverToken).map(([, m]) => m.title)).not.toContain('Your driver has arrived');
});

it('tells both participants about a cancel', async () => {
  const { rider, driver, ride } = await assigned();
  const [riderToken, driverToken] = [await device(rider), await device(driver)];
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await Promise.all([pushed(riderToken, 'Ride cancelled'), pushed(driverToken, 'Ride cancelled')]);
});

it('still cancels for users without a registered phone, and sends nothing', async () => {
  const { rider, ride } = await assigned();
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await app.get(NotificationsService).deliver({
    recipients: [rider.id],
    message: { title: 'x', body: 'y', tag: 'no-phone', data: { type: 'ride', rideId: ride.id, seq: '1' } },
  });
  expect(sentWithTag('no-phone')).toEqual([]);
});

it('forgets a token FCM says is gone', async () => {
  const { rider, ride } = await assigned();
  const token = await device(rider);
  send.mockResolvedValueOnce({ invalid: [token], retry: false });
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await until(async () => (await db().query<unknown[]>('SELECT 1 FROM device_tokens WHERE token = $1', [token])).length === 0);
});

it('sends again when FCM asks for a retry', async () => {
  const { rider, ride } = await assigned();
  const token = await device(rider);
  send.mockResolvedValueOnce({ invalid: [], retry: true });
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await until(() => sentTo(token).length === 2);
  expect(sentTo(token).map(([, m]) => m.title)).toEqual(['Ride cancelled', 'Ride cancelled']);
});

it('keeps the outbox row when the push cannot be queued, so it goes out on a later drain', async () => {
  const { rider, ride } = await assigned();
  const token = await device(rider);
  const addBulk = jest.spyOn(app.get(PushQueue), 'addBulk').mockRejectedValueOnce(new Error('redis gone'));
  await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);
  await pushed(token, 'Ride cancelled');
  expect(addBulk.mock.calls.length).toBeGreaterThanOrEqual(2);
  addBulk.mockRestore();
});

it('sends nothing for an offer that expired while the push waited', async () => {
  const { driver, ride, offerId } = await offered();
  await device(driver);
  const message = { title: 'New ride offer', body: 'y', data: { type: 'offer', rideId: ride.id, offerId } } as const;
  await app.get(NotificationsService).deliver({
    recipients: [driver.id],
    message: { ...message, tag: 'expired', expiresAt: new Date((await dbNow()) - 1000).toISOString() },
  });
  expect(sentWithTag('expired')).toEqual([]);
  // The control: the same message with time left does go out, so the absence above is the expiry's doing
  await app.get(NotificationsService).deliver({
    recipients: [driver.id],
    message: { ...message, tag: 'in-time', expiresAt: new Date((await dbNow()) + 5000).toISOString() },
  });
  expect(sentWithTag('in-time')).toHaveLength(1);
});
