import { OFFER_UPDATED_EVENT, type Offer, type Point, type Quote, RIDE_UPDATED_EVENT, type Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingService } from '../src/matching/matching.service';
import { MatchingQueue } from '../src/shared/queue/matching-queue';
import type { Config } from '../src/shared/config/env';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

let databaseUrl: string;
let app: INestApplication<App>;
let url: string;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const sync = (rideId: string) => app.get(MatchingService).sync(rideId);
// Same database and Redis as `app`, with its own queue; closed by the test that boots it
const bootWorker = async (overrides: Partial<Config> = {}) =>
  (await bootApp({}, { DATABASE_URL: databaseUrl, MATCHING_WORKER: true, ...overrides })).init();

beforeAll(async () => {
  databaseUrl = await isolatedDatabase();
  app = await bootApp({}, { DATABASE_URL: databaseUrl });
  await app.listen(0, '127.0.0.1'); // sockets need a real port
  url = await app.getUrl();
});

const sockets: Socket[] = [];
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

// Every test works in its own spot, ~22 km from the others, so earlier tests' drivers are never candidates
let spots = 0;
const nextSpot = (): Point => {
  const i = spots++;
  return { lat: 12.2 + (i % 5) * 0.2, lng: 105.6 + Math.floor(i / 5) * 0.2 };
};
const north = (p: Point, m: number): Point => ({ lat: p.lat + m / 111_320, lng: p.lng });
const dbNow = async (seconds: number) =>
  ((await db().query<{ t: Date }[]>(`SELECT now() + make_interval(secs => $1) AS t`, [seconds]))[0].t).toISOString();

// A verified driver, online unless asked otherwise, last seen at `at` a second ago
const driver = async (at: Point, { vehicleType = 'remork', online = true } = {}) => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType, plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  const d = await signIn(app, me.phone); // a fresh token carries the driver role
  if (online) await http().put('/drivers/me/availability').set(d.auth).send({ online: true }).expect(200);
  await http()
    .post('/drivers/me/locations')
    .set(d.auth)
    .send({ points: [{ ...at, recordedAt: await dbNow(-1) }] })
    .expect(200);
  return d;
};
const book = async (rider: Actor, pickup: Point, through = app) => {
  const trip = { pickup, dropoff: north(pickup, 3000), vehicleType: 'remork' };
  const quote = (await request(through.getHttpServer()).post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await request(through.getHttpServer()).post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201))
    .body as Ride;
};
type OfferRow = { driver_id: string; status: string; responded_at: Date | null; ttl_s: number; distance_m: number };
const offersOf = (rideId: string) =>
  db().query<OfferRow[]>(
    `SELECT driver_id, status, responded_at, distance_m, extract(epoch FROM expires_at - created_at)::float AS ttl_s
     FROM ride_offers WHERE ride_id = $1 ORDER BY created_at`,
    [rideId],
  );
const availability = async (a: Actor) =>
  (await db().query<{ availability: string }[]>('SELECT availability FROM drivers WHERE user_id = $1', [a.id]))[0]
    .availability;
const until = async (check: () => Promise<boolean>, ms: number, what: string) => {
  for (const end = Date.now() + ms; !(await check()); ) {
    if (Date.now() > end) throw new Error(`${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

// A connected socket recording offer and ride events; a sentinel ride event marks "everything before it arrived"
const listen = async (a: Actor) => {
  const socket = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('connect_error', reject));
  const offers: Offer[] = [];
  const rides: unknown[] = [];
  socket.on(OFFER_UPDATED_EVENT, (e: Offer) => offers.push(e));
  socket.on(RIDE_UPDATED_EVENT, (e) => rides.push(e));
  const drained = async () => {
    await db().query(
      `INSERT INTO outbox_events (topic, recipients, payload) VALUES ($1, ARRAY[$2]::uuid[], '{"sentinel":true}')`,
      [RIDE_UPDATED_EVENT, a.id],
    );
    await until(() => Promise.resolve(rides.some((r) => (r as { sentinel?: boolean }).sentinel)), 2000, 'sentinel');
  };
  return { offers, rides, drained };
};

describe('MatchingService.sync', () => {
  it('offers the ride to the nearest available driver for 15 s, and tells only that driver', async () => {
    const spot = nextSpot();
    const near = await driver(north(spot, 500));
    const far = await driver(north(spot, 1500));
    const [n, f] = [await listen(near), await listen(far)];
    const ride = await book(await signIn(app), spot);

    await sync(ride.id);

    const [offer] = await offersOf(ride.id);
    expect(await offersOf(ride.id)).toHaveLength(1);
    expect(offer).toMatchObject({ driver_id: near.id, status: 'pending', responded_at: null, ttl_s: 15 });
    expect(Math.abs(offer.distance_m - 500)).toBeLessThan(20);
    expect([await availability(near), await availability(far)]).toEqual(['reserved', 'available']);
    await Promise.all([n.drained(), f.drained()]);
    expect(n.offers).toEqual([
      expect.objectContaining({
        rideId: ride.id,
        status: 'pending',
        distanceM: offer.distance_m,
        vehicleType: 'remork',
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        fare: ride.fare,
      }),
    ]);
    expect(Date.parse(n.offers[0].expiresAt) - Date.parse(await dbNow(0))).toBeGreaterThan(13_000);
    expect(f.offers).toEqual([]);
  });

  it.each([
    ['offline', (d: Actor) => http().put('/drivers/me/availability').set(d.auth).send({ online: false }).expect(200)],
    ['holding another offer', (d: Actor) => db().query(`UPDATE drivers SET availability = 'reserved' WHERE user_id = $1`, [d.id])],
    ['on a trip', (d: Actor) => db().query(`UPDATE drivers SET availability = 'on_trip' WHERE user_id = $1`, [d.id])],
    ['not seen for 61 s', (d: Actor) =>
      db().query(`UPDATE driver_locations SET received_at = now() - interval '61 seconds' WHERE driver_id = $1`, [d.id])],
    ['suspended', (d: Actor) => db().query(`UPDATE drivers SET verification = 'suspended' WHERE user_id = $1`, [d.id])],
  ])('passes over a nearer driver who is %s', async (_, makeUnfit) => {
    const spot = nextSpot();
    const unfit = await driver(north(spot, 200));
    const fit = await driver(north(spot, 1500));
    await makeUnfit(unfit);
    const ride = await book(await signIn(app), spot);
    await sync(ride.id);
    expect((await offersOf(ride.id)).map((o) => o.driver_id)).toEqual([fit.id]);
  });

  it('passes over a driver of another vehicle type, the ride’s own rider, and a driver already offered this ride', async () => {
    const spot = nextSpot();
    const moto = await driver(north(spot, 100), { vehicleType: 'moto' });
    const riderWhoDrives = await driver(north(spot, 200));
    const declined = await driver(north(spot, 300));
    const fit = await driver(north(spot, 1500));
    const ride = await book(riderWhoDrives, spot);
    await db().query(
      `INSERT INTO ride_offers (ride_id, driver_id, status, distance_m, expires_at, responded_at)
       VALUES ($1, $2, 'declined', 300, now(), now())`,
      [ride.id, declined.id],
    );
    await sync(ride.id);
    expect((await offersOf(ride.id)).filter((o) => o.status === 'pending').map((o) => o.driver_id)).toEqual([fit.id]);
    expect(await availability(moto)).toBe('available');
  });

  it('searches within 2 km first and widens every 30 s', async () => {
    const spot = nextSpot();
    const d = await driver(north(spot, 2500));
    const ride = await book(await signIn(app), spot);
    await sync(ride.id);
    expect(await offersOf(ride.id)).toEqual([]);
    await db().query(`UPDATE rides SET created_at = now() - interval '35 seconds' WHERE id = $1`, [ride.id]);
    await sync(ride.id);
    expect((await offersOf(ride.id)).map((o) => o.driver_id)).toEqual([d.id]);
  });

  it('keeps one pending offer per ride however often it syncs', async () => {
    const spot = nextSpot();
    await driver(north(spot, 100));
    await driver(north(spot, 200));
    const ride = await book(await signIn(app), spot);
    await sync(ride.id);
    await Promise.all([sync(ride.id), sync(ride.id)]);
    expect(await offersOf(ride.id)).toHaveLength(1);
  });

  it('gives up 90 s after booking: no_driver_found, by the system, told to the rider', async () => {
    const spot = nextSpot();
    const rider = await signIn(app);
    const r = await listen(rider);
    const ride = await book(rider, spot);
    await db().query(`UPDATE rides SET created_at = now() - interval '91 seconds' WHERE id = $1`, [ride.id]);
    await driver(north(spot, 100)); // too late: the deadline wins over a candidate

    await sync(ride.id);

    const now = (await http().get(`/rides/${ride.id}`).set(rider.auth).expect(200)).body as Ride;
    expect(now).toMatchObject({ status: 'no_driver_found', version: 2 });
    expect(await offersOf(ride.id)).toEqual([]);
    const [event] = await db().query<unknown[]>(`SELECT actor, actor_id FROM ride_events WHERE ride_id = $1 AND seq = 2`, [ride.id]);
    expect(event).toEqual({ actor: 'system', actor_id: null });
    await r.drained();
    expect(r.rides).toContainEqual(now);
  });

  it('cancels the pending offer of a ride that stopped searching, frees the driver and tells them', async () => {
    const spot = nextSpot();
    const d = await driver(north(spot, 100));
    const listener = await listen(d);
    const rider = await signIn(app);
    const ride = await book(rider, spot);
    await sync(ride.id);
    await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);

    await sync(ride.id);

    const [offer] = await offersOf(ride.id);
    expect(offer).toMatchObject({ driver_id: d.id, status: 'cancelled' });
    expect(offer.responded_at).toBeInstanceOf(Date);
    expect(await availability(d)).toBe('available');
    await listener.drained();
    expect(listener.offers.map((o) => o.status)).toEqual(['pending', 'cancelled']);
  });

  // Review Focus 3. Gate: an exclusive lock on drivers holds both syncs at the candidate query until both
  // have arrived, so they really overlap. Decided by FOR UPDATE SKIP LOCKED (matching.repository.ts).
  it('offers one driver to only one of two rides synced at the same moment', async () => {
    for (let round = 0; round < 5; round++) {
      const spot = nextSpot();
      const d = await driver(north(spot, 100));
      const rides = [await book(await signIn(app), spot), await book(await signIn(app), spot)];
      const gate = db().createQueryRunner();
      await gate.connect();
      await gate.startTransaction();
      await gate.query('LOCK TABLE drivers IN ACCESS EXCLUSIVE MODE');
      const racing = rides.map((r) => sync(r.id));
      await until(
        async () =>
          (
            await db().query<{ n: number }[]>(
              `SELECT count(*)::int AS n FROM pg_stat_activity
               WHERE datname = current_database() AND wait_event_type = 'Lock'`,
            )
          )[0].n === 2,
        10_000,
        'not all 2 syncs arrived at the lock',
      );
      await gate.commitTransaction();
      await gate.release();

      const results = await Promise.allSettled(racing);
      expect(results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))).toEqual([]);
      const offers = [...(await offersOf(rides[0].id)), ...(await offersOf(rides[1].id))];
      expect(offers.map((o) => o.driver_id)).toEqual([d.id]);
      expect(await availability(d)).toBe('reserved');
    }
  });
});

describe('MatchingService.sweep', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps going past a ride whose sync fails', async () => {
    const failing = await book(await signIn(app), nextSpot());
    const next = await book(await signIn(app), nextSpot());
    const service = app.get(MatchingService);
    const synced: string[] = [];
    jest.spyOn(service, 'sync').mockImplementation((rideId) => {
      synced.push(rideId);
      return rideId === failing.id ? Promise.reject(new Error('poison ride')) : Promise.resolve();
    });
    await service.sweep();
    expect(synced).toEqual(expect.arrayContaining([failing.id, next.id]));
  });
});

describe('MatchingService.expire', () => {
  const expire = (offerId: string) => app.get(MatchingService).expire(offerId);
  const offered = async () => {
    const spot = nextSpot();
    const first = await driver(north(spot, 100));
    const next = await driver(north(spot, 500));
    const ride = await book(await signIn(app), spot);
    await sync(ride.id);
    const [{ id }] = await db().query<{ id: string }[]>(`SELECT id FROM ride_offers WHERE ride_id = $1`, [ride.id]);
    return { first, next, ride, offerId: id };
  };
  const due = (offerId: string) =>
    db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 millisecond' WHERE id = $1`, [offerId]);

  it('expires a due offer, frees and tells its driver, and offers the ride to the next one', async () => {
    const { first, next, ride, offerId } = await offered();
    const listener = await listen(first);
    await due(offerId);

    await expire(offerId);

    const offers = await offersOf(ride.id);
    expect(offers.map((o) => [o.driver_id, o.status])).toEqual([
      [first.id, 'expired'],
      [next.id, 'pending'],
    ]);
    expect(offers[0].responded_at).toBeInstanceOf(Date);
    expect([await availability(first), await availability(next)]).toEqual(['available', 'reserved']);
    await listener.drained();
    expect(listener.offers.map((o) => o.status)).toEqual(['expired']);
  });

  it('leaves an offer alone that was answered first, or is not due yet', async () => {
    const { first, ride, offerId } = await offered();
    await expire(offerId); // not due: 15 s left
    expect((await offersOf(ride.id)).map((o) => o.status)).toEqual(['pending']);
    await http().post(`/offers/${offerId}/accept`).set(first.auth).expect(200);
    await due(offerId);
    await expire(offerId);
    expect((await offersOf(ride.id)).map((o) => o.status)).toEqual(['accepted']);
    expect(await availability(first)).toBe('on_trip');
  });
});

describe('through the queue', () => {
  // The offer is committed before its timer is queued: a Redis failure then must not fail the sync (a job retry
  // would find the pending offer and never queue the timer); the reconciler expires such an offer
  it('keeps a committed offer when its timer cannot be queued', async () => {
    const solo = await bootWorker({ MATCHING_WORKER: false });
    try {
      const spot = nextSpot();
      const d = await driver(north(spot, 100));
      const ride = await book(await signIn(app), spot);
      await solo.get(MatchingQueue).close(); // Redis gone for this instance
      await expect(solo.get(MatchingService).sync(ride.id)).resolves.toBeUndefined();
      expect((await offersOf(ride.id)).map((o) => o.driver_id)).toEqual([d.id]);
    } finally {
      await solo.close();
    }
  });

  it('offers a new booking without anyone calling sync', async () => {
    const worker = await bootWorker();
    try {
      const spot = nextSpot();
      const d = await driver(north(spot, 100));
      const ride = await book(await signIn(app), spot, worker);
      await until(async () => (await offersOf(ride.id)).length === 1, 2000, 'no offer');
      expect((await offersOf(ride.id))[0].driver_id).toBe(d.id);
    } finally {
      await worker.close();
    }
  });

  it('offers the ride to the next driver when the first one stays silent', async () => {
    const worker = await bootWorker({ OFFER_TTL_SECONDS: 1 });
    try {
      const spot = nextSpot();
      const silent = await driver(north(spot, 100));
      const next = await driver(north(spot, 500));
      const ride = await book(await signIn(app), spot, worker);
      await until(async () => (await offersOf(ride.id)).length === 2, 4000, 'no second offer');
      expect((await offersOf(ride.id)).map((o) => [o.driver_id, o.status])).toEqual([
        [silent.id, 'expired'],
        [next.id, 'pending'],
      ]);
    } finally {
      await worker.close();
    }
  });

  // Review Focus 1: the API's clock (which set the delay) runs ahead of the DB's (which decides expiry)
  it('re-arms a timer that fires before the offer is due', async () => {
    const worker = await bootWorker();
    try {
      const spot = nextSpot();
      await driver(north(spot, 100));
      const ride = await book(await signIn(app), spot);
      await sync(ride.id); // through app: its timer sits in app's queue, which has no worker
      const [{ id }] = await db().query<{ id: string }[]>(`SELECT id FROM ride_offers WHERE ride_id = $1`, [ride.id]);
      await db().query(`UPDATE ride_offers SET expires_at = now() + interval '1500 milliseconds' WHERE id = $1`, [id]);
      await worker.get(MatchingQueue).offerTimeout(id, 0); // fires now, 1.5 s early

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await offersOf(ride.id))[0].status).toBe('pending');
      await until(async () => (await offersOf(ride.id))[0].status === 'expired', 3000, 'not expired when due');
    } finally {
      await worker.close();
    }
  });

  // Review Focus 2 / invariant 9: the timer outlives the instance that set it
  it('fires an offer timer on another instance after the first one shut down', async () => {
    const prefix = `test-${Date.now()}-restart`;
    const spot = nextSpot();
    await driver(north(spot, 100));
    const ride = await book(await signIn(app), spot);
    const first = await bootWorker({ QUEUE_PREFIX: prefix, OFFER_TTL_SECONDS: 2 });
    await first.get(MatchingService).sync(ride.id);
    await first.close();
    expect((await offersOf(ride.id))[0].status).toBe('pending');

    const second = await bootWorker({ QUEUE_PREFIX: prefix });
    try {
      await until(async () => (await offersOf(ride.id))[0].status === 'expired', 4000, 'timer lost with its instance');
    } finally {
      await second.close();
    }
  });

  // A booking whose enqueue never ran (the API died after commit): booked through `app`, whose queue has no
  // worker, and found by another instance's sweep
  it('sweeps up a searching ride whose enqueue was lost', async () => {
    const spot = nextSpot();
    const d = await driver(north(spot, 100));
    const ride = await book(await signIn(app), spot);
    const sweeper = await bootWorker({ SWEEP_INTERVAL_MS: 500 });
    try {
      await until(async () => (await offersOf(ride.id)).length === 1, 3000, 'no offer');
      expect((await offersOf(ride.id))[0].driver_id).toBe(d.id);
    } finally {
      await sweeper.close();
    }
  });
});
