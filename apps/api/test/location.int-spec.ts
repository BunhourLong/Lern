import { DRIVER_POSITION_EVENT, type LocationPoint, type Point, type Quote, type Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { LocationService } from '../src/location/location.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { type Actor, bootApp, signIn } from './support/actors';
import { assign } from './support/offers';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
let url: string;
const sockets: Socket[] = [];
const connect = async (a: Actor) => {
  const socket = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => socket.once('connect', () => resolve()).once('connect_error', reject));
  return socket;
};
const send = (socket: Socket, payload: unknown): Promise<unknown> =>
  socket.timeout(2000).emitWithAck('driver:location', payload);

beforeAll(async () => {
  app = await bootApp();
  await app.listen(0, '127.0.0.1'); // sockets need a real port
  url = await app.getUrl();
});

afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
// Instants come from the DB clock, the one that decides which points are "in the future"
const at = async (seconds: number) =>
  ((await db().query<{ t: Date }[]>(`SELECT now() + make_interval(secs => $1) AS t`, [seconds]))[0].t).toISOString();
const pt = (lat: number, lng: number, recordedAt: string): LocationPoint => ({ lat, lng, recordedAt });
const post = (a: Actor, body: unknown) => http().post('/drivers/me/locations').set(a.auth).send(body as object);
type Row = { lat: number; lng: number; recorded_at: Date; received_at: Date };
const stored = async (id: string) =>
  db().query<Row[]>(
    `SELECT ST_Y(position::geometry) lat, ST_X(position::geometry) lng, recorded_at, received_at
       FROM driver_locations WHERE driver_id = $1`,
    [id],
  );

const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'remork' };
// A fresh rider's ride accepted by d
const assigned = async (d: Actor) => {
  const rider = await signIn(app);
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  const ride = (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  await assign(app, d, ride.id);
  return { rider, rideId: ride.id };
};
const step = (a: Actor, rideId: string, s: string, body: object = {}) =>
  http().post(`/rides/${rideId}/${s}`).set(a.auth).send(body).expect(200);
// ...walked on with driver steps (arrive, start, complete)
const rideOf = async (d: Actor, ...steps: string[]) => {
  const { rideId } = await assigned(d);
  for (const s of steps) await step(d, rideId, s);
  return rideId;
};
const tripPoints = (rideId: string) =>
  db().query<Omit<Row, 'received_at'>[]>(
    `SELECT ST_Y(position::geometry) lat, ST_X(position::geometry) lng, recorded_at
       FROM trip_points WHERE ride_id = $1 ORDER BY recorded_at`,
    [rideId],
  );
// Start of a 10 s bucket a minute ago, in ms, so test points sit on known bucket boundaries
const bucketStart = async () =>
  (
    await db().query<{ t: Date }[]>(
      `SELECT date_bin('10 seconds', now() - interval '60 seconds', timestamptz '2000-01-01Z') AS t`,
    )
  )[0].t.getTime();

describe('POST /drivers/me/locations', () => {
  it('stores the newest point of a batch, whatever the array order', async () => {
    const d = await verifiedDriver();
    const res = await post(d, {
      points: [pt(11.55, 104.91, await at(-30)), pt(11.56, 104.92, await at(-10)), pt(11.57, 104.93, await at(-20))],
    });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ dropped: 0 });
    const rows = await stored(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(11.56, 6);
    expect(rows[0].lng).toBeCloseTo(104.92, 6);
  });

  it('drops points older than or equal to the stored one (out of order)', async () => {
    const d = await verifiedDriver();
    const t10 = await at(-10);
    await post(d, { points: [pt(11.56, 104.92, t10)] }).expect(200);
    const [before] = await stored(d.id);

    for (const points of [[pt(11.6, 104.95, await at(-20))], [pt(11.6, 104.95, t10)]]) {
      const res = await post(d, { points });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({ dropped: 0 });
      expect(await stored(d.id)).toEqual([before]); // incl. received_at: an equal point is a no-op
    }
  });

  it('drops points more than 30 s in the future and applies the rest', async () => {
    const d = await verifiedDriver();
    const res = await post(d, { points: [pt(11.56, 104.92, await at(-5)), pt(11.6, 104.95, await at(300))] });
    expect(res.body).toEqual({ dropped: 1 });
    const rows = await stored(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(11.56, 6);

    const fresh = await verifiedDriver();
    const only = await post(fresh, { points: [pt(11.6, 104.95, await at(300))] });
    expect(only.status).toBe(HttpStatus.OK);
    expect(only.body).toEqual({ dropped: 1 });
    expect(await stored(fresh.id)).toHaveLength(0);
  });

  it('accepts a timezone offset', async () => {
    const d = await verifiedDriver();
    const instant = await at(-10);
    const local = new Date(new Date(instant).getTime() + 7 * 3600_000).toISOString().replace('Z', '+07:00');
    await post(d, { points: [pt(11.56, 104.92, local)] }).expect(200);
    expect((await stored(d.id))[0].recorded_at.toISOString()).toBe(instant);
  });

  it('accepts the +14:00 edge offset', async () => {
    const d = await verifiedDriver();
    const instant = await at(-10);
    const local = new Date(new Date(instant).getTime() + 14 * 3600_000).toISOString().replace('Z', '+14:00');
    await post(d, { points: [pt(11.56, 104.92, local)] }).expect(200);
    expect((await stored(d.id))[0].recorded_at.toISOString()).toBe(instant);
  });

  it('400 and no row for invalid batches', async () => {
    const d = await verifiedDriver();
    const ok = pt(11.56, 104.92, await at(-5));
    const bad = [
      { points: [] },
      { points: Array.from({ length: 101 }, () => ok) },
      { points: [{ ...ok, lat: 13.75, lng: 100.5 }] }, // Bangkok
      { points: [{ ...ok, recordedAt: 'yesterday' }] },
      { points: [{ ...ok, recordedAt: '0000-01-01T00:00:00Z' }] }, // Postgres: out of range
      { points: [{ ...ok, recordedAt: '2026-10-21T17:00:00+23:59' }] }, // Postgres: zone out of range
      {},
    ];
    for (const body of bad) expect((await post(d, body)).status).toBe(HttpStatus.BAD_REQUEST);
    expect(await stored(d.id)).toHaveLength(0);
  });

  it('403 for a rider, a pending driver and a suspended driver; no row', async () => {
    const body = { points: [pt(11.56, 104.92, await at(-5))] };
    const rider = await signIn(app);
    const pending = await signIn(app);
    await http().post('/drivers/me').set(pending.auth).send({ vehicleType: 'moto', plate: 'PP 1A-1111' }).expect(201);
    const pendingDriver = await signIn(app, pending.phone);
    const suspended = await verifiedDriver();
    await db().query(`UPDATE drivers SET verification = 'suspended' WHERE user_id = $1`, [suspended.id]);
    for (const a of [rider, pendingDriver, suspended]) {
      expect((await post(a, body)).status).toBe(HttpStatus.FORBIDDEN);
      expect(await stored(a.id)).toHaveLength(0);
    }
  });

  it("writes only the caller's row (IDOR)", async () => {
    const [a, b] = [await verifiedDriver(), await verifiedDriver()];
    await post(a, { driverId: b.id, points: [pt(11.56, 104.92, await at(-5))] }).expect(200);
    expect(await stored(a.id)).toHaveLength(1);
    expect(await stored(b.id)).toHaveLength(0);
  });

  it('parallel batches end on the newest point (ordering, not a gated race)', async () => {
    const d = await verifiedDriver();
    const secs = [-20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1];
    const times = await Promise.all(secs.map((s) => at(s)));
    // Fixed permutation (odd indexes, then even) so failures reproduce; the newest is not last
    const shuffled = [...times.filter((_, i) => i % 2), ...times.filter((_, i) => !(i % 2))];
    // Built in one synchronous map so the requests share the server and overlap
    const results = await Promise.all(
      shuffled.map((t, i) => post(d, { points: [pt(11.5 + i / 1000, 104.9, t)] })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(HttpStatus.OK));
    const [row] = await stored(d.id);
    const newest = times[times.length - 1];
    expect(row.recorded_at.toISOString()).toBe(newest);
    // The position comes from the winning point, not just its timestamp
    expect(row.lat).toBeCloseTo(11.5 + shuffled.indexOf(newest) / 1000, 6);
  });
});

describe('socket driver:location', () => {
  it("stores a verified driver's point", async () => {
    const d = await verifiedDriver();
    const ack = await send(await connect(d), pt(11.56, 104.92, await at(-5)));
    expect(ack).toEqual({ dropped: 0 });
    const rows = await stored(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(11.56, 6);
  });

  it('answers an invalid point with BAD_REQUEST and stores nothing', async () => {
    const d = await verifiedDriver();
    const socket = await connect(d);
    const ok = pt(11.56, 104.92, await at(-5));
    const bad = [
      pt(13.75, 100.5, await at(-5)),
      { lat: 11.56, lng: 104.92 },
      'x',
      { ...ok, recordedAt: '0000-01-01T00:00:00Z' },
      { ...ok, recordedAt: '2026-10-21T17:00:00+23:59' },
    ];
    for (const payload of bad) expect(await send(socket, payload)).toEqual({ error: 'BAD_REQUEST' });
    expect(await stored(d.id)).toHaveLength(0);
  });

  it('answers a rider and a pending driver with FORBIDDEN and stores nothing', async () => {
    const rider = await signIn(app);
    const pending = await signIn(app);
    await http().post('/drivers/me').set(pending.auth).send({ vehicleType: 'remork', plate: 'PP 2A-5678' }).expect(201);
    const pendingDriver = await signIn(app, pending.phone);
    for (const a of [rider, pendingDriver]) {
      expect(await send(await connect(a), pt(11.56, 104.92, await at(-5)))).toEqual({ error: 'FORBIDDEN' });
      expect(await stored(a.id)).toHaveLength(0);
    }
  });

  it('answers a driver suspended mid-connection with FORBIDDEN on the next message', async () => {
    const d = await verifiedDriver();
    const socket = await connect(d);
    expect(await send(socket, pt(11.56, 104.92, await at(-10)))).toEqual({ dropped: 0 });
    await db().query(`UPDATE drivers SET verification = 'suspended' WHERE user_id = $1`, [d.id]);
    expect(await send(socket, pt(11.6, 104.95, await at(-5)))).toEqual({ error: 'FORBIDDEN' });
    const rows = await stored(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(11.56, 6);
  });

  it("stores only the sender's own point (IDOR)", async () => {
    const [a, b] = [await verifiedDriver(), await verifiedDriver()];
    const ack = await send(await connect(a), { ...pt(11.56, 104.92, await at(-5)), driverId: b.id });
    expect(ack).toEqual({ dropped: 0 });
    expect(await stored(a.id)).toHaveLength(1);
    expect(await stored(b.id)).toHaveLength(0);
  });
});

describe('trip_points', () => {
  it('keeps one point per 10 s bucket of an in_progress ride, the earliest in each', async () => {
    const d = await verifiedDriver();
    const rideId = await rideOf(d, 'arrive', 'start');
    const base = await bucketStart();
    const p = (s: number) => pt(11.55 + s / 1000, 104.92, new Date(base + s * 1000).toISOString());
    const times = (rows: { recorded_at: Date }[]) => rows.map((r) => r.recorded_at.toISOString());

    // +3 comes before +1 in the array: the earlier point wins its bucket, not the first sent
    const res = await post(d, { points: [p(12), p(3), p(1), p(25), pt(11.6, 104.95, await at(300))] });
    expect(res.body).toEqual({ dropped: 1 });
    const rows = await tripPoints(rideId);
    expect(times(rows)).toEqual([p(1), p(12), p(25)].map((x) => x.recordedAt));
    expect(rows[0].lat).toBeCloseTo(11.551, 6);

    // A replay and a point in a taken bucket add nothing; a late point in a new bucket fills the gap
    await post(d, { points: [p(12), p(3), p(1), p(25), p(5)] }).expect(200);
    await post(d, { points: [p(35)] }).expect(200);
    await post(d, { points: [p(-15)] }).expect(200);
    expect(times(await tripPoints(rideId))).toEqual([p(-15), p(1), p(12), p(25), p(35)].map((x) => x.recordedAt));
  });

  it('samples nothing before the trip starts or after it ends', async () => {
    for (const steps of [[], ['arrive'], ['arrive', 'start', 'complete']]) {
      const d = await verifiedDriver();
      const rideId = await rideOf(d, ...steps);
      await post(d, { points: [pt(11.56, 104.92, await at(-5))] }).expect(200);
      expect(await tripPoints(rideId)).toHaveLength(0);
    }
  });

  it("adds points only to the caller's own ride (IDOR)", async () => {
    const d = await verifiedDriver();
    const rideId = await rideOf(d, 'arrive', 'start');
    const other = await verifiedDriver();
    await post(other, { rideId, points: [pt(11.56, 104.92, await at(-5))] }).expect(200);
    expect(await tripPoints(rideId)).toHaveLength(0);
  });

  it('samples socket points too', async () => {
    const d = await verifiedDriver();
    const rideId = await rideOf(d, 'arrive', 'start');
    expect(await send(await connect(d), pt(11.56, 104.92, await at(-5)))).toEqual({ dropped: 0 });
    expect(await tripPoints(rideId)).toHaveLength(1);
  });
});

describe('LocationService.nearby', () => {
  // Suites share the DB, so each test looks only at its own drivers; the default limit is high so other
  // suites' drivers can't push them out before that filter
  const nearby = async (p: Point, radiusM: number, mine: Actor[], limit = 10_000) => {
    const ids = mine.map((a) => a.id);
    return (await app.get(LocationService).nearby(p, radiusM, limit)).filter((r) => ids.includes(r.driverId));
  };
  const driverAt = async (p: Point) => {
    const d = await verifiedDriver();
    await http().put('/drivers/me/availability').set(d.auth).send({ online: true }).expect(200);
    await post(d, { points: [pt(p.lat, p.lng, await at(-1))] }).expect(200);
    return d;
  };
  const receivedAgo = (a: Actor, seconds: number) =>
    db().query(`UPDATE driver_locations SET received_at = now() - make_interval(secs => $2) WHERE driver_id = $1`, [
      a.id,
      seconds,
    ]);
  const quay = { lat: 11.564, lng: 104.931 }; // rider on Sisowath Quay

  it('orders by straight-line distance, so a driver across the river ranks first (M4 re-ranks by road ETA)', async () => {
    const acrossRiver = await driverAt({ lat: 11.564, lng: 104.948 }); // far bank (Arey Ksat side): ~1854 m
    const sameBank = await driverAt({ lat: 11.548, lng: 104.92 }); // same bank, ~2137 m, shorter by road
    const outside = await driverAt({ lat: 11.59, lng: 104.89 }); // ~5.3 km
    const res = await nearby(quay, 3000, [acrossRiver, sameBank, outside]);
    expect(res.map((r) => r.driverId)).toEqual([acrossRiver.id, sameBank.id]);
    expect(Math.abs(res[0].distanceM - 1854)).toBeLessThan(20);
    expect(Math.abs(res[1].distanceM - 2137)).toBeLessThan(20);
  });

  it('lists only fresh, verified, available drivers', async () => {
    const spot = { lat: 11.566, lng: 104.929 };
    const ds = [];
    for (let i = 0; i < 7; i++) ds.push(await driverAt(spot)); // sequential: parallel sign-in chains hang supertest
    const [fresh, recent, stale, suspended, offline, reserved, onTrip] = ds;
    await receivedAgo(recent, 59);
    await receivedAgo(stale, 61);
    await db().query(`UPDATE drivers SET verification = 'suspended' WHERE user_id = $1`, [suspended.id]);
    await http().put('/drivers/me/availability').set(offline.auth).send({ online: false }).expect(200);
    for (const [d, state] of [[reserved, 'reserved'], [onTrip, 'on_trip']] as const)
      await db().query('UPDATE drivers SET availability = $2 WHERE user_id = $1', [d.id, state]);
    const res = await nearby(quay, 1000, ds);
    expect(res.map((r) => r.driverId).sort()).toEqual([fresh.id, recent.id].sort());
  });

  it('returns at most limit drivers, the nearest', async () => {
    const spot = { lat: 11.53, lng: 104.88 }; // no other suite reports near here
    const ds = [];
    for (const i of [2, 0, 1]) ds[i] = await driverAt({ lat: spot.lat + i * 0.0001, lng: spot.lng });
    const res = await nearby(spot, 100, ds, 2);
    expect(res.map((r) => r.driverId)).toEqual([ds[0].id, ds[1].id]);
  });

  // Each test sits in a town no other suite reports from, so the whole body is the test's own drivers
  describe('GET /drivers/nearby', () => {
    const get = (a: Actor, query: object) => http().get('/drivers/nearby').set(a.auth).query(query);

    it('returns positions within 3 km, nearest first, rounded to 3 decimals and without ids', async () => {
      const kampot = { lat: 10.612, lng: 104.18 };
      await driverAt({ lat: 10.61234, lng: 104.18166 }); // ~180 m
      await driverAt({ lat: 10.638, lng: 104.18 }); // ~2.9 km
      await driverAt({ lat: 10.61, lng: 104.2 }); // ~2.2 km
      await driverAt({ lat: 10.642, lng: 104.18 }); // ~3.3 km: outside
      const rider = await signIn(app);
      const res = await get(rider, kampot).expect(200);
      expect(res.body).toEqual({
        drivers: [
          { lat: 10.612, lng: 104.182 },
          { lat: 10.61, lng: 104.2 },
          { lat: 10.638, lng: 104.18 },
        ],
      });
    });

    it('returns at most the nearest 10', async () => {
      const battambang = { lat: 13.1, lng: 103.2 };
      for (const i of [10, 3, 0, 7, 1, 9, 2, 8, 4, 6, 5]) await driverAt({ lat: 13.1 + i * 0.001, lng: 103.2 });
      const rider = await signIn(app);
      const res = await get(rider, battambang).expect(200);
      expect((res.body as { drivers: Point[] }).drivers.map((d) => d.lat)).toEqual(
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => Number((13.1 + i * 0.001).toFixed(3))),
      );
    });

    it('400 for a missing, out-of-area or non-numeric point', async () => {
      const rider = await signIn(app);
      for (const q of [{ lat: 11.56 }, { lat: 1, lng: 104.9 }, { lat: 'x', lng: 104.9 }, { lat: '', lng: 104.9 }])
        await get(rider, q).expect(400);
    });

    it('is 401 without a token and 403 for a user without the rider role', async () => {
      await http().get('/drivers/nearby').query({ lat: 11.56, lng: 104.92 }).expect(401);
      const user = await signIn(app);
      await db().query('DELETE FROM user_roles WHERE user_id = $1', [user.id]);
      const again = await signIn(app, user.phone);
      await get(again, { lat: 11.56, lng: 104.92 }).expect(403);
    });
  });
});

describe('driver position to the rider', () => {
  // Positions a's socket received so far. The sentinel goes out after everything the test caused before the
  // call, on the same ordered stream, so "nothing yet" means nothing was sent.
  const watch = async (a: Actor) => {
    const socket = await connect(a);
    const got: unknown[] = [];
    socket.on(DRIVER_POSITION_EVENT, (e) => got.push(e));
    return async () => {
      const done = new Promise((resolve) => socket.once('sentinel', resolve));
      app.get(RealtimeGateway).server.to(`user:${a.id}`).emit('sentinel');
      await done;
      return got.splice(0);
    };
  };
  const unthrottle = (d: Actor) => app.get(Redis).del(`rl:driver-position:${d.id}`);
  const position = (rideId: string, p: LocationPoint) => ({ rideId, ...p });

  it("sends the assigned driver's newest point from both paths while assigned, arrived and in progress", async () => {
    const d = await verifiedDriver();
    const driverSocket = await connect(d);
    const { rider, rideId } = await assigned(d);
    const received = await watch(rider);

    const p1 = pt(11.561, 104.921, await at(-5));
    await send(driverSocket, p1);
    expect(await received()).toEqual([position(rideId, p1)]);

    await unthrottle(d);
    await step(d, rideId, 'arrive');
    const [older, newer] = [pt(11.562, 104.922, await at(-4)), pt(11.563, 104.923, await at(-3))];
    await post(d, { points: [newer, older] }).expect(200);
    expect(await received()).toEqual([position(rideId, newer)]);

    await unthrottle(d);
    await step(d, rideId, 'start');
    const p3 = pt(11.564, 104.924, await at(-2));
    await send(driverSocket, p3);
    expect(await received()).toEqual([position(rideId, p3)]);
  });

  it('sends nothing after the ride completes or is cancelled, and nothing for an out-of-order point', async () => {
    const d = await verifiedDriver();
    const socket = await connect(d);
    const done = await assigned(d);
    const doneReceived = await watch(done.rider);
    for (const s of ['arrive', 'start', 'complete']) await step(d, done.rideId, s);
    await send(socket, pt(11.561, 104.921, await at(-9)));
    expect(await doneReceived()).toEqual([]);

    const cancelled = await assigned(d);
    const cancelledReceived = await watch(cancelled.rider);
    await step(cancelled.rider, cancelled.rideId, 'cancel', { reason: 'changed_mind' });
    await unthrottle(d);
    await send(socket, pt(11.562, 104.922, await at(-8)));
    expect(await cancelledReceived()).toEqual([]);

    const active = await assigned(d);
    const activeReceived = await watch(active.rider);
    await unthrottle(d);
    await send(socket, pt(11.563, 104.923, await at(-1)));
    await unthrottle(d);
    await send(socket, pt(11.564, 104.924, await at(-7))); // older than the stored point
    expect(await activeReceived()).toHaveLength(1);
  });

  it('never sends to anyone else: other riders, other drivers, users with no ride (privacy)', async () => {
    const [d, other] = [await verifiedDriver(), await verifiedDriver()];
    const mine = await assigned(d);
    const theirs = await assigned(other);
    const stranger = await signIn(app);
    const watchers = [await watch(mine.rider), await watch(theirs.rider), await watch(other), await watch(stranger)];
    await post(d, { points: [pt(11.561, 104.921, await at(-1))] }).expect(200);
    expect(await Promise.all(watchers.map((w) => w()))).toEqual([[expect.anything()], [], [], []]);
  });

  it('throttles to one position per driver every 2 s', async () => {
    const d = await verifiedDriver();
    const socket = await connect(d);
    const { rider } = await assigned(d);
    const received = await watch(rider);
    await send(socket, pt(11.561, 104.921, await at(-3)));
    await send(socket, pt(11.562, 104.922, await at(-2)));
    expect(await received()).toHaveLength(1);
    await unthrottle(d);
    await send(socket, pt(11.563, 104.923, await at(-1)));
    expect(await received()).toHaveLength(1);
  });

  it('still stores the point when Redis fails, and shares nothing', async () => {
    const d = await verifiedDriver();
    const { rider } = await assigned(d);
    const received = await watch(rider);
    const p = pt(11.561, 104.921, await at(-1));
    const multi = jest.spyOn(app.get(Redis), 'multi').mockImplementation(() => {
      throw new Error('redis down');
    });
    try {
      await post(d, { points: [p] }).expect(200);
    } finally {
      multi.mockRestore();
    }
    expect((await stored(d.id))[0].recorded_at.toISOString()).toBe(p.recordedAt);
    expect(await received()).toEqual([]);
  });
});
