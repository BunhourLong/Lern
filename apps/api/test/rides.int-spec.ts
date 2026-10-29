import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { assign } from './support/offers';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'remork' };
const newQuote = async (a: Actor) => (await http().post('/quotes').set(a.auth).send(trip).expect(201)).body as Quote;
const book = (a: Actor, quoteId: string) => http().post('/rides').set(a.auth).send({ quoteId });
const rideCount = async (a: Actor) =>
  (await db().query<{ n: number }[]>('SELECT count(*)::int AS n FROM rides WHERE rider_id = $1', [a.id]))[0].n;

beforeAll(async () => {
  app = await (await bootApp()).init();
});

afterAll(() => app.close());

describe('POST /rides', () => {
  it('books a searching ride at the quoted price', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    const res = await book(rider, quote.id);
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toMatchObject({
      status: 'searching',
      version: 1,
      vehicleType: 'remork',
      pickup: trip.pickup,
      dropoff: trip.dropoff,
      fare: quote.fare,
    });
    expect(await rideCount(rider)).toBe(1);
  });

  it('keeps the quoted price even if the quote row changes later (price snapshot)', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    const ride = (await book(rider, quote.id).expect(201)).body as Ride;
    await db().query('UPDATE quotes SET amount_minor = 1 WHERE id = $1', [quote.id]);
    const [row] = await db().query<{ fare_minor: string }[]>('SELECT fare_minor FROM rides WHERE id = $1', [ride.id]);
    expect(Number(row.fare_minor)).toBe(quote.fare.amountMinor);
  });

  it('is 410 for an expired quote, by database time', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    await db().query(`UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1`, [quote.id]);
    expect((await book(rider, quote.id)).status).toBe(HttpStatus.GONE);
    expect(await rideCount(rider)).toBe(0);
  });

  it('is 404 for an unknown quote and 400 for a malformed id', async () => {
    const rider = await signIn(app);
    expect((await book(rider, randomUUID())).status).toBe(HttpStatus.NOT_FOUND);
    expect((await book(rider, 'nope')).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('allows one active ride per rider, even when two bookings race', async () => {
    const rider = await signIn(app);
    const [q1, q2] = [await newQuote(rider), await newQuote(rider)];
    const statuses = (await Promise.all([book(rider, q1.id), book(rider, q2.id)])).map((r) => r.status).sort();
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT]);
    expect(await rideCount(rider)).toBe(1);
  });

  it('books a quote at most once', async () => {
    const rider = await signIn(app);
    const quote = await newQuote(rider);
    await book(rider, quote.id).expect(201);
    expect((await book(rider, quote.id)).status).toBe(HttpStatus.CONFLICT);
    expect(await rideCount(rider)).toBe(1);
  });

  it('is 401 without a token and 403 without the rider role', async () => {
    expect((await http().post('/rides').send({ quoteId: randomUUID() })).status).toBe(HttpStatus.UNAUTHORIZED);
    const user = await signIn(app);
    await db().query('DELETE FROM user_roles WHERE user_id = $1', [user.id]);
    const res = await http().post('/auth/refresh').send({ refreshToken: user.tokens.refreshToken });
    const roleless = { authorization: `Bearer ${(res.body as { accessToken: string }).accessToken}` };
    expect((await http().post('/rides').set(roleless).send({ quoteId: randomUUID() })).status).toBe(
      HttpStatus.FORBIDDEN,
    );
  });
});

const verifiedDriver = async (vehicleType = 'remork', user?: Actor) => {
  const me = user ?? (await signIn(app));
  await http().post('/drivers/me').set(me.auth).send({ vehicleType, plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const searchingRide = async () => {
  const rider = await signIn(app);
  return (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
};
const getRide = (a: Actor, rideId: string) => http().get(`/rides/${rideId}`).set(a.auth);

const availability = async (a: Actor) =>
  (await db().query<{ availability: string }[]>('SELECT availability FROM drivers WHERE user_id = $1', [a.id]))[0]
    .availability;
const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const events = (rideId: string) =>
  db().query<{ seq: number; status: string; actor: string; actor_id: string | null }[]>(
    'SELECT seq, status, actor, actor_id FROM ride_events WHERE ride_id = $1 ORDER BY seq',
    [rideId],
  );

describe('POST /rides/:id/{arrive,start,complete}', () => {
  it('walks the trip to completed, one guarded step and one event per version', async () => {
    const rider = await signIn(app);
    const ride = (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
    const driver = await verifiedDriver();
    await assign(app, driver, ride.id);
    for (const [action, status, version] of [
      ['arrive', 'driver_arrived', 3],
      ['start', 'in_progress', 4],
      ['complete', 'completed', 5],
    ] as const) {
      expect((await step(driver, ride.id, action).expect(200)).body).toMatchObject({ status, version });
    }
    expect(await events(ride.id)).toEqual([
      { seq: 1, status: 'searching', actor: 'rider', actor_id: rider.id },
      { seq: 2, status: 'driver_assigned', actor: 'driver', actor_id: driver.id },
      { seq: 3, status: 'driver_arrived', actor: 'driver', actor_id: driver.id },
      { seq: 4, status: 'in_progress', actor: 'driver', actor_id: driver.id },
      { seq: 5, status: 'completed', actor: 'driver', actor_id: driver.id },
    ]);
    // A completed trip frees the driver
    expect(await availability(driver)).toBe('available');
    await assign(app, driver, (await searchingRide()).id);
  });

  it('is 409 with the snapshot for an out-of-order step, and writes no event', async () => {
    const ride = await searchingRide();
    const driver = await verifiedDriver();
    await assign(app, driver, ride.id);
    const res = await step(driver, ride.id, 'complete');
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ code: 'INVALID_TRANSITION', ride: { status: 'driver_assigned', version: 2 } });
    expect(await events(ride.id)).toHaveLength(2);
  });

  it("is 404 for another driver's ride and leaves it untouched (IDOR)", async () => {
    const ride = await searchingRide();
    const [driver, other] = [await verifiedDriver(), await verifiedDriver()];
    await assign(app, driver, ride.id);
    expect((await step(other, ride.id, 'arrive')).status).toBe(HttpStatus.NOT_FOUND);
    expect((await getRide(driver, ride.id)).body).toMatchObject({ status: 'driver_assigned', version: 2 });
  });

  it('is 403 for a rider, 400 for an unknown action', async () => {
    const ride = await searchingRide();
    const driver = await verifiedDriver();
    expect((await step(await signIn(app), ride.id, 'arrive')).status).toBe(HttpStatus.FORBIDDEN);
    expect((await step(driver, ride.id, 'teleport')).status).toBe(HttpStatus.BAD_REQUEST);
  });
});

// IDOR (see test/support/actors.ts): B can't book A's quote or learn that it exists
describe('ownership', () => {
  it("never lets one rider book another rider's quote", async () => {
    const [a, b] = [await signIn(app), await signIn(app)];
    const quote = await newQuote(a);
    expect((await book(b, quote.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect(await rideCount(b)).toBe(0);
    // A can still book it: B's attempt didn't consume it
    expect((await book(a, quote.id)).status).toBe(HttpStatus.CREATED);
  });

  it('ignores an owner smuggled into the booking body', async () => {
    const [a, b] = [await signIn(app), await signIn(app)];
    const quote = await newQuote(b);
    await http().post('/rides').set(b.auth).send({ quoteId: quote.id, riderId: a.id }).expect(201);
    expect([await rideCount(a), await rideCount(b)]).toEqual([0, 1]);
  });

  it("hides a ride from every user but its rider and assigned driver, and doesn't reveal it exists", async () => {
    const ride = await searchingRide();
    const [otherRider, otherDriver] = [await signIn(app), await verifiedDriver()];
    expect((await getRide(otherDriver, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await getRide(otherRider, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    await assign(app, await verifiedDriver(), ride.id);
    expect((await getRide(otherDriver, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await getRide(otherRider, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('GET /rides/:id', () => {
  it('shows the rider their ride, and the assigned driver the same snapshot', async () => {
    const rider = await signIn(app);
    const booked = (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
    expect((await getRide(rider, booked.id).expect(200)).body).toEqual(booked);

    const driver = await verifiedDriver();
    const accepted = await assign(app, driver, booked.id);
    expect((await getRide(driver, booked.id).expect(200)).body).toEqual(accepted);
    expect((await getRide(rider, booked.id).expect(200)).body).toEqual(accepted);
  });

  it('is 404 for an unknown ride, 400 for a malformed id and 401 without a token', async () => {
    const rider = await signIn(app);
    expect((await getRide(rider, randomUUID())).status).toBe(HttpStatus.NOT_FOUND);
    expect((await getRide(rider, 'nope')).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await http().get(`/rides/${randomUUID()}`)).status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

const cancel = (a: Actor, rideId: string, body: object = { reason: 'changed_mind' }) =>
  http().post(`/rides/${rideId}/cancel`).set(a.auth).send(body);
const stored = async (rideId: string) =>
  (
    await db().query<{ status: string; version: number; cancel_reason: string | null }[]>(
      'SELECT status, version, cancel_reason FROM rides WHERE id = $1',
      [rideId],
    )
  )[0];
// A rider's ride accepted by a fresh driver, optionally walked on with driver steps
const assignedRide = async (...steps: string[]) => {
  const rider = await signIn(app);
  const ride = (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
  const driver = await verifiedDriver();
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return { rider, driver, ride };
};

describe('POST /rides/:id/cancel', () => {
  it('lets the rider cancel a searching ride with a reason, and frees them to book again', async () => {
    const rider = await signIn(app);
    const ride = (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
    const res = await cancel(rider, ride.id);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ ...ride, status: 'cancelled', version: 2 });
    expect(await stored(ride.id)).toEqual({ status: 'cancelled', version: 2, cancel_reason: 'changed_mind' });
    expect((await events(ride.id))[1]).toEqual({ seq: 2, status: 'cancelled', actor: 'rider', actor_id: rider.id });
    await book(rider, (await newQuote(rider)).id).expect(201);
  });

  it.each([
    ['rider', []],
    ['rider', ['arrive']],
    ['driver', []],
    ['driver', ['arrive']],
  ] as const)('lets the %s cancel after accept + %j, and frees the driver', async (who, steps) => {
    const { rider, driver, ride } = await assignedRide(...steps);
    const actor = who === 'rider' ? rider : driver;
    const res = await cancel(actor, ride.id, { reason: 'waited_too_long' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({ status: 'cancelled', version: 3 + steps.length });
    expect((await events(ride.id)).at(-1)).toMatchObject({ status: 'cancelled', actor: who, actor_id: actor.id });
    expect(await availability(driver)).toBe('available');
    await assign(app, driver, (await searchingRide()).id);
  });

  it('is 409 with the snapshot once the trip has started, and for a second cancel', async () => {
    const { rider, driver, ride } = await assignedRide('arrive', 'start');
    for (const who of [rider, driver]) {
      const res = await cancel(who, ride.id);
      expect(res.status).toBe(HttpStatus.CONFLICT);
      expect(res.body).toMatchObject({ code: 'INVALID_TRANSITION', ride: { status: 'in_progress', version: 4 } });
    }
    const other = await assignedRide();
    await cancel(other.rider, other.ride.id).expect(200);
    expect((await cancel(other.driver, other.ride.id)).body).toMatchObject({ ride: { status: 'cancelled', version: 3 } });
    expect(await events(other.ride.id)).toHaveLength(3);
  });

  it('lets exactly one of rider and driver win when both cancel at once', async () => {
    const { rider, driver, ride } = await assignedRide();
    const statuses = (await Promise.all([cancel(rider, ride.id), cancel(driver, ride.id)])).map((r) => r.status);
    expect([...statuses].sort()).toEqual([HttpStatus.OK, HttpStatus.CONFLICT]);
    expect(await events(ride.id)).toHaveLength(3);
  });

  it('is 400 without a known reason, and leaves the ride untouched', async () => {
    const ride = await searchingRide();
    const rider = await signIn(app);
    for (const body of [{}, { reason: 'bored' }]) {
      expect((await cancel(rider, ride.id, body)).status).toBe(HttpStatus.BAD_REQUEST);
    }
    expect(await stored(ride.id)).toEqual({ status: 'searching', version: 1, cancel_reason: null });
  });

  it("is 404 for anyone but the ride's rider and assigned driver, and leaves it untouched (IDOR)", async () => {
    const ride = await searchingRide();
    const [otherRider, otherDriver] = [await signIn(app), await verifiedDriver()];
    expect((await cancel(otherDriver, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await cancel(otherRider, ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    const assigned = await assignedRide();
    expect((await cancel(otherDriver, assigned.ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect((await cancel(otherRider, assigned.ride.id)).status).toBe(HttpStatus.NOT_FOUND);
    expect(await stored(ride.id)).toMatchObject({ status: 'searching', version: 1 });
    expect(await stored(assigned.ride.id)).toMatchObject({ status: 'driver_assigned', version: 2 });
  });

  it('is 404 for an unknown ride, 400 for a malformed id and 401 without a token', async () => {
    const rider = await signIn(app);
    expect((await cancel(rider, randomUUID())).status).toBe(HttpStatus.NOT_FOUND);
    expect((await cancel(rider, 'nope')).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await http().post(`/rides/${randomUUID()}/cancel`).send({ reason: 'other' })).status).toBe(
      HttpStatus.UNAUTHORIZED,
    );
  });
});

const activeRides = (a: Actor) => http().get('/me/active-ride').set(a.auth);

describe('GET /me/active-ride', () => {
  it('follows a ride from booking to the end, for its rider and its driver only', async () => {
    const rider = await signIn(app);
    const booked = (await book(rider, (await newQuote(rider)).id).expect(201)).body as Ride;
    expect((await activeRides(rider).expect(200)).body).toEqual({ rider: booked, driver: null });

    const driver = await verifiedDriver();
    const accepted = await assign(app, driver, booked.id);
    expect((await activeRides(rider).expect(200)).body).toEqual({ rider: accepted, driver: null });
    expect((await activeRides(driver).expect(200)).body).toEqual({ rider: null, driver: accepted });
    expect((await activeRides(await verifiedDriver()).expect(200)).body).toEqual({ rider: null, driver: null });

    await cancel(rider, booked.id).expect(200);
    for (const who of [rider, driver]) {
      expect((await activeRides(who).expect(200)).body).toEqual({ rider: null, driver: null });
    }
  });

  it('shows both sides for a user who is riding one ride and driving another', async () => {
    const user = await signIn(app);
    const own = (await book(user, (await newQuote(user)).id).expect(201)).body as Ride;
    const driving = await assign(app, await verifiedDriver('remork', user), (await searchingRide()).id);
    expect((await activeRides(await signIn(app, user.phone)).expect(200)).body).toEqual({ rider: own, driver: driving });
  });

  it('is 401 without a token', async () => {
    expect((await http().get('/me/active-ride')).status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
