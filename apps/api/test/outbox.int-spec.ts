import { type Quote, RIDE_UPDATED_EVENT, type Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';

let app: INestApplication<App>;
let url: string;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'remork' };
const book = async (a: Actor) => {
  const quote = (await http().post('/quotes').set(a.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(a.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
const move = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};

// A connected socket that records every ride:updated it receives; take(n) waits for the n-th one
const sockets: Socket[] = [];
const listen = async (a: Actor) => {
  const socket = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('connect_error', reject));
  const events: unknown[] = [];
  socket.on(RIDE_UPDATED_EVENT, (e) => events.push(e));
  const take = async (n: number, ms: number) => {
    for (const end = Date.now() + ms; events.length < n; ) {
      if (Date.now() > end) throw new Error(`${events.length} of ${n} events within ${ms} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return events;
  };
  return { events, take };
};
// Delivered through the outbox like any ride event, after everything the test sent before it
const sentinel = (a: Actor) =>
  db().query(`INSERT INTO outbox_events (topic, recipients, payload) VALUES ($1, ARRAY[$2]::uuid[], '{"sentinel":true}')`, [
    RIDE_UPDATED_EVENT,
    a.id,
  ]);

beforeAll(async () => {
  app = await bootApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

it('announces every ride change to both participants right after commit, as the full snapshot', async () => {
  const [rider, driver] = [await signIn(app), await verifiedDriver()];
  const [r, d] = [await listen(rider), await listen(driver)];

  // Each event within 500 ms: the writer kicks the dispatcher, the 1 s poll alone would miss most of these
  const sent = [await book(rider)];
  await r.take(1, 500);
  for (const action of ['accept', 'arrive', 'start', 'complete']) {
    if (action === 'complete') expect((await move(rider, sent[0].id, 'cancel').send({ reason: 'other' })).status).toBe(HttpStatus.CONFLICT);
    sent.push((await move(driver, sent[0].id, action).expect(200)).body as Ride);
    await Promise.all([r.take(sent.length, 500), d.take(sent.length - 1, 500)]);
  }

  // At-least-once from any instance, in any order: clients keep the highest version (invariant 8)
  const byVersion = (events: unknown[]) => [...(events as Ride[])].sort((a, b) => a.version - b.version);
  expect(byVersion(r.events)).toEqual(sent);
  expect(byVersion(d.events)).toEqual(sent.slice(1));
});

it('announces a cancel to both participants', async () => {
  const [rider, driver] = [await signIn(app), await verifiedDriver()];
  const [r, d] = [await listen(rider), await listen(driver)];
  const ride = await book(rider);
  await move(driver, ride.id, 'accept').expect(200);
  const cancelled = (await move(rider, ride.id, 'cancel').send({ reason: 'changed_mind' }).expect(200)).body as Ride;
  expect(cancelled.status).toBe('cancelled');
  expect(await r.take(3, 2000)).toContainEqual(cancelled);
  expect(await d.take(2, 2000)).toContainEqual(cancelled);
});

it('tells nobody else: not a driver who lost the race, not another rider', async () => {
  const [rider, winner, loser, otherRider] = [await signIn(app), await verifiedDriver(), await verifiedDriver(), await signIn(app)];
  const [l, o] = [await listen(loser), await listen(otherRider)];
  const r = await listen(rider);

  const ride = await book(rider);
  await move(winner, ride.id, 'accept').expect(200);
  expect((await move(loser, ride.id, 'accept')).status).toBe(HttpStatus.CONFLICT);
  await r.take(2, 2000);

  await Promise.all([sentinel(loser), sentinel(otherRider)]);
  expect(await l.take(1, 2000)).toEqual([{ sentinel: true }]);
  expect(await o.take(1, 2000)).toEqual([{ sentinel: true }]);
});

// Scoped to this file it proves the poll; in a full run another suite's kick may drain the row first
it('delivers rows nobody kicked for (writer crashed after commit) and removes what it sent', async () => {
  const rider = await signIn(app);
  const r = await listen(rider);
  const [{ id }] = await db().query<{ id: string }[]>(
    `INSERT INTO outbox_events (topic, recipients, payload) VALUES ($1, ARRAY[$2]::uuid[], '{"orphan":true}') RETURNING id`,
    [RIDE_UPDATED_EVENT, rider.id],
  );
  expect(await r.take(1, 2500)).toEqual([{ orphan: true }]);
  expect(await db().query('SELECT 1 FROM outbox_events WHERE id = $1', [id])).toEqual([]);
});
