import type { Offer, Point, Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingService } from '../src/matching/matching.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { offer } from './support/offers';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Own database: the race test counts lock waiters across the whole database
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
});

afterAll(() => app.close());

const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const quay = { lat: 11.5564, lng: 104.9282 };
const book = async (rider: Actor, pickup: Point = quay) => {
  const trip = { pickup, dropoff: { lat: pickup.lat - 0.01, lng: pickup.lng - 0.01 }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
const accept = (a: Actor, offerId: string) => http().post(`/offers/${offerId}/accept`).set(a.auth);
const decline = (a: Actor, offerId: string) => http().post(`/offers/${offerId}/decline`).set(a.auth);
const row = async <T>(sql: string, params: unknown[]) => (await db().query<T[]>(sql, params))[0];
const offerRow = (id: string) =>
  row<{ status: string; responded_at: Date | null }>('SELECT status, responded_at FROM ride_offers WHERE id = $1', [id]);
const rideRow = (id: string) =>
  row<{ status: string; version: number; driver_id: string | null }>(
    'SELECT status, version, driver_id FROM rides WHERE id = $1',
    [id],
  );
const availability = async (a: Actor) =>
  (await row<{ availability: string }>('SELECT availability FROM drivers WHERE user_id = $1', [a.id])).availability;

describe('POST /offers/:id/accept', () => {
  it('assigns the ride to the offer’s driver, who is now on a trip', async () => {
    const ride = await book(await signIn(app));
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);

    const res = await accept(driver, offerId);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ ...ride, status: 'driver_assigned', version: 2 });
    expect(await rideRow(ride.id)).toEqual({ status: 'driver_assigned', version: 2, driver_id: driver.id });
    expect((await offerRow(offerId)).status).toBe('accepted');
    expect((await offerRow(offerId)).responded_at).toBeInstanceOf(Date);
    expect(await availability(driver)).toBe('on_trip');
  });

  it('is 409 with the offer once it has expired by the database clock, and changes nothing', async () => {
    const ride = await book(await signIn(app));
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);
    await db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 second' WHERE id = $1`, [offerId]);

    const res = await accept(driver, offerId);

    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ code: 'INVALID_TRANSITION', offer: { id: offerId, rideId: ride.id, status: 'pending' } });
    expect(await rideRow(ride.id)).toEqual({ status: 'searching', version: 1, driver_id: null });
    expect(await availability(driver)).toBe('reserved');
  });

  // Review Focus 5
  it('is 409 once the rider cancelled, and the next sync ends the offer and frees the driver', async () => {
    const rider = await signIn(app);
    const ride = await book(rider);
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);
    await http().post(`/rides/${ride.id}/cancel`).set(rider.auth).send({ reason: 'changed_mind' }).expect(200);

    expect((await accept(driver, offerId)).status).toBe(HttpStatus.CONFLICT);
    expect((await rideRow(ride.id)).status).toBe('cancelled');

    await app.get(MatchingService).sync(ride.id);
    expect((await offerRow(offerId)).status).toBe('cancelled');
    expect(await availability(driver)).toBe('available');
  });

  // Review Focus 4
  it('stays acceptable after the driver tried to go offline while holding it', async () => {
    const ride = await book(await signIn(app));
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);
    const off = await http().put('/drivers/me/availability').set(driver.auth).send({ online: false });
    expect(off.status).toBe(HttpStatus.CONFLICT);
    expect(off.body).toMatchObject({ availability: 'reserved' });
    await accept(driver, offerId).expect(200);
  });

  it('replays the first answer for a repeated Idempotency-Key', async () => {
    const ride = await book(await signIn(app));
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);
    const key = randomUUID();
    const first = await accept(driver, offerId).set('Idempotency-Key', key).expect(200);
    const again = await accept(driver, offerId).set('Idempotency-Key', key).expect(200);
    expect(again.body).toEqual(first.body);
  });

  it("is 404 for another driver's offer and for an unknown one, and changes nothing (IDOR)", async () => {
    const ride = await book(await signIn(app));
    const [mine, other] = [await verifiedDriver(), await verifiedDriver()];
    const offerId = await offer(app, mine, ride.id);
    expect((await accept(other, offerId)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await decline(other, offerId)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await accept(other, offerId)).body).not.toHaveProperty('offer');
    expect((await accept(mine, randomUUID())).status).toBe(HttpStatus.NOT_FOUND);
    expect((await offerRow(offerId)).status).toBe('pending');
    expect(await rideRow(ride.id)).toEqual({ status: 'searching', version: 1, driver_id: null });
  });

  it('is 400 for a malformed id, 403 for a rider or an unverified driver, 401 without a token', async () => {
    const ride = await book(await signIn(app));
    const driver = await verifiedDriver();
    const offerId = await offer(app, driver, ride.id);
    expect((await accept(driver, 'nope')).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await accept(await signIn(app), offerId)).status).toBe(HttpStatus.FORBIDDEN);
    await db().query(`UPDATE drivers SET verification = 'suspended' WHERE user_id = $1`, [driver.id]);
    expect((await accept(driver, offerId)).status).toBe(HttpStatus.FORBIDDEN);
    expect((await http().post(`/offers/${offerId}/accept`)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await offerRow(offerId)).status).toBe('pending');
  });

  // Invariant 2 still holds if availability ever drifts: the partial unique turns it into a 409
  it('never gives a driver a second active ride', async () => {
    const driver = await verifiedDriver();
    const first = await book(await signIn(app));
    await accept(driver, await offer(app, driver, first.id)).expect(200);
    const second = await book(await signIn(app));
    const [{ id }] = await db().query<{ id: string }[]>(
      `INSERT INTO ride_offers (ride_id, driver_id, distance_m, expires_at)
       VALUES ($1, $2, 0, now() + interval '15 seconds') RETURNING id`,
      [second.id, driver.id],
    );
    await db().query(`UPDATE drivers SET availability = 'reserved' WHERE user_id = $1`, [driver.id]);
    const res = await accept(driver, id);
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ message: 'Driver already has an active ride' });
    expect((await rideRow(second.id)).status).toBe('searching');
  });

  // Same driver tapping accept N times (retries without a key). Gate: an exclusive lock on rides holds every
  // accept at its guarded ride UPDATE until all N have arrived. N + gate + this monitor fit the pool of 10.
  it('lets exactly one of 8 parallel accepts of one offer win', async () => {
    const N = 8;
    for (let round = 0; round < 3; round++) {
      const ride = await book(await signIn(app));
      const driver = await verifiedDriver();
      const offerId = await offer(app, driver, ride.id);
      const gate = db().createQueryRunner();
      await gate.connect();
      await gate.startTransaction();
      await gate.query('LOCK TABLE rides IN ACCESS EXCLUSIVE MODE');
      const racing = Array.from({ length: N }, () => accept(driver, offerId).then((r) => r));
      for (const end = Date.now() + 10_000; ; ) {
        const [{ n }] = await db().query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (n === N) break;
        if (Date.now() > end) throw new Error(`not all ${N} accepts arrived (${n})`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await gate.commitTransaction();
      await gate.release();

      const statuses = (await Promise.all(racing)).map((r) => r.status).sort();
      expect(statuses).toEqual([HttpStatus.OK, ...Array<number>(N - 1).fill(HttpStatus.CONFLICT)]);
      expect(await rideRow(ride.id)).toEqual({ status: 'driver_assigned', version: 2, driver_id: driver.id });
      const [{ n }] = await db().query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM ride_events WHERE ride_id = $1 AND status = 'driver_assigned'`,
        [ride.id],
      );
      expect(n).toBe(1);
    }
  });
});

describe('POST /offers/:id/decline', () => {
  it('frees the driver, who is never offered that ride again, and the next driver gets it', async () => {
    const siemReap = { lat: 13.36, lng: 103.86 }; // no other test reports near here
    const near = await verifiedDriver();
    const next = await verifiedDriver();
    for (const [d, m] of [[near, 100], [next, 500]] as const) {
      await http().put('/drivers/me/availability').set(d.auth).send({ online: true }).expect(200);
      const at = (await row<{ t: Date }>(`SELECT now() - interval '1 second' AS t`, [])).t.toISOString();
      await http()
        .post('/drivers/me/locations')
        .set(d.auth)
        .send({ points: [{ lat: siemReap.lat + m / 111_320, lng: siemReap.lng, recordedAt: at }] })
        .expect(200);
    }
    const ride = await book(await signIn(app), siemReap);
    const sync = () => app.get(MatchingService).sync(ride.id);
    await sync();
    const [first] = await db().query<{ id: string; driver_id: string }[]>(
      `SELECT id, driver_id FROM ride_offers WHERE ride_id = $1`,
      [ride.id],
    );
    expect(first.driver_id).toBe(near.id);

    const res = await decline(near, first.id);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({ id: first.id, rideId: ride.id, status: 'declined' } satisfies Partial<Offer>);
    expect(await availability(near)).toBe('available');
    expect((await decline(near, first.id)).body).toMatchObject({ code: 'INVALID_TRANSITION', offer: { status: 'declined' } });

    await sync();
    const pending = await db().query<{ driver_id: string }[]>(
      `SELECT driver_id FROM ride_offers WHERE ride_id = $1 AND status = 'pending'`,
      [ride.id],
    );
    expect(pending).toEqual([{ driver_id: next.id }]);
  });

  it('is 403 for a rider', async () => {
    const ride = await book(await signIn(app));
    const offerId = await offer(app, await verifiedDriver(), ride.id);
    expect((await decline(await signIn(app), offerId)).status).toBe(HttpStatus.FORBIDDEN);
  });
});

// accept now falls through to the driver-step route, which knows no such step
it('has no open pool any more', async () => {
  const ride = await book(await signIn(app));
  const driver = await verifiedDriver();
  expect((await http().post(`/rides/${ride.id}/accept`).set(driver.auth)).status).toBe(HttpStatus.BAD_REQUEST);
  expect((await rideRow(ride.id)).status).toBe('searching');
});
