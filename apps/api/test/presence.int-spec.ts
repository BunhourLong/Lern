import { DRIVER_CONNECTIVITY_EVENT, type DriverConnectivity, type Quote, type Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { LocationService } from '../src/location/location.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { assign, offer } from './support/offers';

// PLAN.md M5 presence: the heartbeat is driver_locations.received_at; the sweep tells the rider of an active ride
// when their driver goes silent (and back), and takes long-silent available drivers offline.

let databaseUrl: string;
let app: INestApplication<App>;
let url: string;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const presence = () => app.get(LocationService).presence(30, 300);

// Own database: the sweep scans every driver
beforeAll(async () => {
  databaseUrl = await isolatedDatabase();
  app = await bootApp({}, { DATABASE_URL: databaseUrl });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
const sockets: Socket[] = [];
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

const pickup = { lat: 11.5564, lng: 104.9282 };
const report = (d: Actor) =>
  http()
    .post('/drivers/me/locations')
    .set(d.auth)
    .send({ points: [{ ...pickup, recordedAt: new Date().toISOString() }] })
    .expect(200);
const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const book = async (rider: Actor) => {
  const trip = { pickup, dropoff: { lat: pickup.lat - 0.01, lng: pickup.lng }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
// A driver who has reported a position and is assigned to a fresh ride
const onTrip = async () => {
  const [rider, driver] = [await signIn(app), await verifiedDriver()];
  await report(driver);
  const ride = await assign(app, driver, (await book(rider)).id);
  return { rider, driver, ride };
};
const silent = (d: Actor, seconds: number) =>
  db().query('UPDATE driver_locations SET received_at = now() - make_interval(secs => $2) WHERE driver_id = $1', [d.id, seconds]);
const receivedAt = async (d: Actor) =>
  (await db().query<{ at: Date }[]>('SELECT received_at AS at FROM driver_locations WHERE driver_id = $1', [d.id]))[0].at;
const availability = async (d: Actor) =>
  (await db().query<{ availability: string }[]>('SELECT availability FROM drivers WHERE user_id = $1', [d.id]))[0].availability;

// A socket recording driver:connectivity; a sentinel sent through the outbox after the action proves absence
const listen = async (a: Actor) => {
  const socket = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('connect_error', reject));
  const events: unknown[] = [];
  socket.on(DRIVER_CONNECTIVITY_EVENT, (e) => events.push(e));
  const take = async (n: number, ms = 500) => {
    for (const end = Date.now() + ms; events.length < n; ) {
      if (Date.now() > end) throw new Error(`${events.length} of ${n} events within ${ms} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return events;
  };
  const nothingMore = async () => {
    await db().query(`INSERT INTO outbox_events (topic, recipients, payload) VALUES ($1, ARRAY[$2]::uuid[], '{"sentinel":true}')`, [
      DRIVER_CONNECTIVITY_EVENT,
      a.id,
    ]);
    const seen = await take(events.length + 1, 2000); // nobody kicks for the sentinel: the 1 s poll sends it
    expect(seen[seen.length - 1]).toEqual({ sentinel: true });
    return seen.slice(0, -1);
  };
  return { take, nothingMore };
};
const near = (iso: string, at: Date) => Math.abs(Date.parse(iso) - at.getTime()) < 1; // to_char keeps ms

describe('stale signal', () => {
  it('tells the rider once when their driver goes silent for 30 s, and once when points resume', async () => {
    const { rider, driver, ride } = await onTrip();
    const r = await listen(rider);
    await silent(driver, 31);

    await presence();
    const [stale] = (await r.take(1)) as DriverConnectivity[];
    expect(stale).toMatchObject({ rideId: ride.id, stale: true });
    expect(near(stale.lastSeenAt, await receivedAt(driver))).toBe(true);

    await presence(); // still silent: already told
    expect(await r.nothingMore()).toEqual([stale]);

    await report(driver);
    await presence();
    const [, , fresh] = (await r.take(3)) as DriverConnectivity[];
    expect(fresh).toMatchObject({ rideId: ride.id, stale: false });
    expect(near(fresh.lastSeenAt, await receivedAt(driver))).toBe(true);
    expect(Date.parse(fresh.lastSeenAt)).toBeGreaterThan(Date.parse(stale.lastSeenAt));
  });

  it('tells nobody else: not the driver, another rider, a past rider, nor anyone before 30 s', async () => {
    const now = await onTrip();
    const quiet = await onTrip();
    const past = await onTrip();
    for (const step of ['arrive', 'start', 'complete']) {
      await http().post(`/rides/${past.ride.id}/${step}`).set(past.driver.auth).expect(200);
    }
    const stranger = await signIn(app);
    const [own, other, early, before] = [
      await listen(now.driver),
      await listen(stranger),
      await listen(quiet.rider),
      await listen(past.rider),
    ];
    const r = await listen(now.rider);
    await silent(now.driver, 31);
    await silent(quiet.driver, 29);
    await silent(past.driver, 31);

    await presence();

    await r.take(1);
    for (const l of [own, other, early, before]) expect(await l.nothingMore()).toEqual([]);
  });

  it('tells the rider of the next ride too when a still-silent driver is assigned again, and only them that they are back', async () => {
    const first = await onTrip();
    const a = await listen(first.rider);
    await silent(first.driver, 31);
    await presence();
    await a.take(1);
    await http().post(`/rides/${first.ride.id}/cancel`).set(first.rider.auth).send({ reason: 'changed_mind' }).expect(200);
    const rider = await signIn(app);
    const next = await assign(app, first.driver, (await book(rider)).id);
    const b = await listen(rider);

    await presence();
    expect(await b.take(1)).toEqual([expect.objectContaining({ rideId: next.id, stale: true })]);
    await report(first.driver);
    await presence();

    expect(await b.take(2)).toEqual([
      expect.objectContaining({ rideId: next.id, stale: true }),
      expect.objectContaining({ rideId: next.id, stale: false }),
    ]);
    expect(await a.nothingMore()).toHaveLength(1);
  });

  it('clears silently when the ride ended before points resumed, and survives a sweep with nothing to do', async () => {
    const { rider, driver, ride } = await onTrip();
    const r = await listen(rider);
    await silent(driver, 31);
    await presence();
    await r.take(1);
    await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);

    await report(driver);
    await presence();
    await presence();

    expect(await r.nothingMore()).toHaveLength(1);
    const [{ staleRideId }] = await db().query<{ staleRideId: string | null }[]>(
      'SELECT stale_ride_id AS "staleRideId" FROM driver_locations WHERE driver_id = $1',
      [driver.id],
    );
    expect(staleRideId).toBeNull();
  });
});

describe('time-out', () => {
  const online = (d: Actor) => http().put('/drivers/me/availability').set(d.auth).send({ online: true }).expect(200);
  const wentOnline = (d: Actor, secondsAgo: number) =>
    db().query('UPDATE driver_availability_events SET created_at = now() - make_interval(secs => $2) WHERE driver_id = $1', [
      d.id,
      secondsAgo,
    ]);
  const lastAction = async (d: Actor) =>
    (
      await db().query<{ action: string }[]>('SELECT action FROM driver_availability_events WHERE driver_id = $1 ORDER BY id DESC LIMIT 1', [
        d.id,
      ])
    )[0].action;

  it('takes an available driver offline after 5 min without a point, through a logged time_out move', async () => {
    const [gone, here] = [await verifiedDriver(), await verifiedDriver()];
    for (const d of [gone, here]) {
      await online(d);
      await report(d);
      await wentOnline(d, 3600);
    }
    await silent(gone, 301);
    await silent(here, 299);

    await presence();

    expect([await availability(gone), await availability(here)]).toEqual(['offline', 'available']);
    expect(await lastAction(gone)).toBe('time_out');
  });

  it('counts going online as a sign of life for a driver who never sent a point', async () => {
    const [gone, fresh] = [await verifiedDriver(), await verifiedDriver()];
    for (const d of [gone, fresh]) await online(d);
    await wentOnline(gone, 301);

    await presence();

    expect([await availability(gone), await availability(fresh)]).toEqual(['offline', 'available']);
  });

  it('never times out a driver holding an offer or on a trip', async () => {
    const holding = await verifiedDriver();
    await report(holding);
    await offer(app, holding, (await book(await signIn(app))).id);
    const { driver: driving } = await onTrip();
    for (const d of [holding, driving]) {
      await silent(d, 301);
      await wentOnline(d, 3600);
    }

    await presence();

    expect([await availability(holding), await availability(driving)]).toEqual(['reserved', 'on_trip']);
  });
});

it('runs every PRESENCE_INTERVAL_MS on the worker without anyone calling it', async () => {
  const { rider, driver, ride } = await onTrip();
  const r = await listen(rider);
  await silent(driver, 31);
  const worker = await (await bootApp({}, { DATABASE_URL: databaseUrl, MATCHING_WORKER: true, PRESENCE_INTERVAL_MS: 200 })).init();
  try {
    expect(await r.take(1, 5000)).toEqual([expect.objectContaining({ rideId: ride.id, stale: true })]);
  } finally {
    await worker.close();
  }
});
