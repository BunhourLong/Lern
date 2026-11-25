import type { Quote, Ride, RideHistoryPage, RideStatus } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { assign } from './support/offers';

// PLAN.md M6.11: the caller's finished rides, newest first, one keyset page at a time
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };
const ITEM_KEYS = ['createdAt', 'dropoff', 'fare', 'id', 'pickup', 'status', 'vehicleType', 'version'];

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

beforeAll(async () => {
  app = await (await bootApp()).init();
});
afterAll(() => app.close());

const list = (a: Actor, query: string) => http().get(`/rides?${query}`).set(a.auth);
// The page for `query`, asserted to answer `status`
const page = async (a: Actor, query: string, status = 200): Promise<RideHistoryPage> =>
  (await list(a, query).expect(status)).body as RideHistoryPage;
const idsOf = (p: RideHistoryPage) => p.items.map((i) => i.id);
const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const newDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'moto', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const searchingRide = async (rider: Actor): Promise<Ride> => {
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
// A ride accepted by the driver (driver_assigned), walked on with the driver's steps
const rideFor = async (driver: Actor, rider: Actor, ...steps: string[]) => {
  const ride = await searchingRide(rider);
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return ride;
};

type Fixture = { status: RideStatus; at: string };
// Rides inserted in one statement, with exact created_at (ISO strings keep microseconds). Returns their ids.
async function seedRides(rider: Actor, driver: Actor | null, rows: Fixture[]): Promise<{ id: string; at: string }[]> {
  const ids = rows.map(() => randomUUID());
  const quotes = rows.map(() => randomUUID());
  await db().query(
    `WITH input AS (
       SELECT * FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::timestamptz[]) AS t(ride, quote, status, at)
     ), q AS (
       INSERT INTO quotes (id, rider_id, pickup, dropoff, vehicle_type, distance_m, duration_s, amount_minor, currency, surge_bp,
                           breakdown, rate_card_id, expires_at)
       SELECT quote, $1, 'SRID=4326;POINT(104.9 11.5)'::geography, 'SRID=4326;POINT(104.8 11.5)'::geography, 'moto', 2000, 400,
              7500, 'KHR', 10000, '{"tripMinor": 7500, "surgeMinor": 0, "bookingFeeMinor": 0}',
              (SELECT id FROM rate_cards WHERE vehicle_type = 'moto' LIMIT 1), now()
       FROM input
     )
     INSERT INTO rides (id, rider_id, driver_id, quote_id, status, version, vehicle_type, pickup, dropoff, fare_minor, currency,
                        commission_bp, commission_minor, cancel_reason, created_at)
     SELECT ride, $1, $2, quote, status, 5, 'moto', 'SRID=4326;POINT(104.9 11.5)'::geography,
            'SRID=4326;POINT(104.8 11.5)'::geography, 7500, 'KHR', 1500, 1125,
            CASE WHEN status = 'cancelled' THEN 'changed_mind' END, at
     FROM input`,
    [rider.id, driver?.id ?? null, ids, quotes, rows.map((r) => r.status), rows.map((r) => r.at)],
  );
  return ids.map((id, i) => ({ id, at: rows[i].at }));
}
// The order the API must return: created_at newest first, then id newest first (uuid text compares like uuid bytes)
const newestFirst = (rows: { id: string; at: string }[]) =>
  [...rows].sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1)).map((r) => r.id);
// Walks the rider's pages at `limit` until nextCursor is null, returning each page's ids
async function walk(a: Actor, limit: number): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor = '';
  for (;;) {
    const res = await page(a, `as=rider&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    pages.push(idsOf(res));
    if (res.nextCursor === null) return pages;
    cursor = encodeURIComponent(res.nextCursor);
  }
}
const cursorOf = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('GET /rides', () => {
  it('lists the rider finished rides newest first, in the ride shape, and leaves out an active ride', async () => {
    const rider = await signIn(app);
    const driver = await newDriver();
    const old = await seedRides(rider, driver, [{ status: 'completed', at: '2026-01-01T10:00:00.000000Z' }]);
    const newer = await seedRides(rider, null, [{ status: 'cancelled', at: '2026-01-02T10:00:00.000000Z' }]);
    const unmatched = await seedRides(rider, null, [{ status: 'no_driver_found', at: '2026-01-01T12:00:00.000000Z' }]);
    await searchingRide(rider); // created now, so newest of all: active, so not listed
    const res = await page(rider, 'as=rider');
    expect(res.nextCursor).toBeNull();
    expect(idsOf(res)).toEqual(newestFirst([...old, ...newer, ...unmatched]));
    expect(res.items[0]).toEqual({
      id: newer[0].id,
      status: 'cancelled',
      version: 5,
      vehicleType: 'moto',
      pickup: { lat: 11.5, lng: 104.9 },
      dropoff: { lat: 11.5, lng: 104.8 },
      fare: { amountMinor: 7500, currency: 'KHR' },
      createdAt: '2026-01-02T10:00:00.000Z',
    });
    for (const item of res.items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
  });

  // Active rides belong to /me/active-ride, never to history. Each case gets its own rider and driver, since the
  // partial uniques allow one active ride per side; a searching ride has no driver yet.
  it.each(['searching', 'driver_assigned', 'driver_arrived', 'in_progress'] as const)(
    'never lists a %s ride, as rider or driver',
    async (status) => {
      const rider = await signIn(app);
      const driver = await newDriver();
      const done = await seedRides(rider, driver, [{ status: 'completed', at: '2026-01-01T10:00:00.000000Z' }]);
      await seedRides(rider, status === 'searching' ? null : driver, [{ status, at: '2026-01-02T10:00:00.000000Z' }]);
      expect(idsOf(await page(rider, 'as=rider'))).toEqual([done[0].id]);
      expect(idsOf(await page(driver, 'as=driver'))).toEqual([done[0].id]);
    },
  );

  it('shows a driver the rides assigned to them under as=driver, and not under as=rider', async () => {
    const driver = await newDriver();
    const rider = await signIn(app);
    const mine = await seedRides(rider, driver, [
      { status: 'completed', at: '2026-01-01T10:00:00.000000Z' },
      { status: 'cancelled', at: '2026-01-02T10:00:00.000000Z' },
    ]);
    const completed = await rideFor(driver, rider, 'arrive', 'start', 'complete'); // real path, created now
    await rideFor(driver, await signIn(app)); // driver_assigned: active, not listed
    expect(idsOf(await page(driver, 'as=driver'))).toEqual([completed.id, ...newestFirst(mine)]);
    expect((await page(driver, 'as=rider')).items).toEqual([]);
  });

  it('pages by keyset: 5 rides at limit 2 give pages 2, 2, 1, with ties and microsecond neighbours across boundaries', async () => {
    const rider = await signIn(app);
    const rows = await seedRides(rider, null, [
      { status: 'completed', at: '2026-01-01T00:00:00.000001Z' }, // r1
      { status: 'completed', at: '2026-01-01T00:00:00.000002Z' }, // r2, a microsecond later than r1
      { status: 'completed', at: '2026-01-03T00:00:00.000000Z' }, // tie A
      { status: 'completed', at: '2026-01-03T00:00:00.000000Z' }, // tie B, same created_at
      { status: 'completed', at: '2026-01-04T00:00:00.000000Z' }, // newest
    ]);
    const pages = await walk(rider, 2);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(pages.flat()).toEqual(newestFirst(rows));
  });

  it('returns 20 by default and 50 at most; nextCursor is null on the last page', async () => {
    const rider = await signIn(app);
    await seedRides(
      rider,
      null,
      Array.from({ length: 21 }, (_, i) => ({ status: 'completed' as const, at: `2026-02-01T00:${String(i).padStart(2, '0')}:00.000000Z` })),
    );
    const first = await page(rider, 'as=rider');
    expect(first.items).toHaveLength(20);
    expect(typeof first.nextCursor).toBe('string');
    const all = await page(rider, 'as=rider&limit=50');
    expect(all.items).toHaveLength(21);
    expect(all.nextCursor).toBeNull();
  });

  it('keeps each caller to their own rides, whatever owner parameters or cursor another caller sends', async () => {
    const a = await signIn(app);
    const b = await signIn(app);
    const driverA = await newDriver();
    const driverB = await newDriver();
    const aRides = await seedRides(a, driverA, [
      { status: 'completed', at: '2026-01-01T00:00:00.000000Z' },
      { status: 'completed', at: '2026-01-02T00:00:00.000000Z' },
      { status: 'cancelled', at: '2026-01-03T00:00:00.000000Z' },
    ]);
    const bRides = await seedRides(b, driverB, [{ status: 'completed', at: '2026-01-02T12:00:00.000000Z' }]);
    const aIds = aRides.map((r) => r.id);
    const bIds = bRides.map((r) => r.id);

    expect(idsOf(await page(b, 'as=rider'))).toEqual(bIds);
    expect((await page(b, 'as=driver')).items).toEqual([]);
    expect(idsOf(await page(driverB, 'as=driver'))).toEqual(bIds);
    expect(idsOf(await page(driverA, 'as=driver'))).toEqual(newestFirst(aRides));

    // Tampering with an owner parameter changes nothing: the query ignores it
    const bOwn = idsOf(await page(b, 'as=rider'));
    for (const param of [`riderId=${a.id}`, `userId=${a.id}`, `driverId=${a.id}`, `rider_id=${a.id}`]) {
      expect(idsOf(await page(b, `as=rider&${param}`))).toEqual(bOwn);
    }
    expect(aIds.some((id) => bOwn.includes(id))).toBe(false);

    // A's cursor, used by B: the keyset is only a position, so B gets B's rides older than it and nothing of A's
    const aFirst = await page(a, 'as=rider&limit=1');
    expect(aFirst.nextCursor).not.toBeNull();
    const cursor = encodeURIComponent(aFirst.nextCursor ?? '');
    expect(idsOf(await page(b, `as=rider&limit=5&cursor=${cursor}`))).toEqual(bIds);
    expect(idsOf(await page(driverB, `as=driver&limit=5&cursor=${cursor}`))).toEqual(bIds);
  });

  it('answers 401 without a token', async () => {
    await http().get('/rides?as=rider').expect(HttpStatus.UNAUTHORIZED);
  });

  it.each([
    ['missing as', ''],
    ['as=admin', 'as=admin'],
    ['limit=0', 'as=rider&limit=0'],
    ['limit=51', 'as=rider&limit=51'],
    ['limit=abc', 'as=rider&limit=abc'],
    ['limit=1.5', 'as=rider&limit=1.5'],
    ['cursor !!!', 'as=rider&cursor=!!!'],
    ['cursor of garbage', `as=rider&cursor=${Buffer.from('not json').toString('base64url')}`],
    ['cursor with a non-uuid id', `as=rider&cursor=${cursorOf({ at: '2026-01-01T00:00:00.000001Z', id: 'nope' })}`],
    ['cursor with a day that does not exist', `as=rider&cursor=${cursorOf({ at: '2026-02-31T00:00:00.000001Z', id: randomUUID() })}`],
    ['cursor in year 0000', `as=rider&cursor=${cursorOf({ at: '0000-01-01T00:00:00.000001Z', id: randomUUID() })}`],
    ['cursor with milliseconds only', `as=rider&cursor=${cursorOf({ at: '2026-01-01T00:00:00.000Z', id: randomUUID() })}`],
  ])('answers 400 for %s', async (_, query) => {
    const rider = await signIn(app);
    await list(rider, query).expect(HttpStatus.BAD_REQUEST);
  });
});
