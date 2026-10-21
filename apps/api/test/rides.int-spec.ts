import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';

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
const accept = (a: Actor, rideId: string) => http().post(`/rides/${rideId}/accept`).set(a.auth);

describe('POST /rides/:id/accept (open pool)', () => {
  it('assigns a searching ride to the driver who accepts, and only to them', async () => {
    const ride = await searchingRide();
    const [first, second] = [await verifiedDriver(), await verifiedDriver()];
    const res = await accept(first, ride.id);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ ...ride, status: 'driver_assigned', version: 2 });

    const late = await accept(second, ride.id);
    expect(late.status).toBe(HttpStatus.CONFLICT);
    expect(late.body).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(late.body).not.toHaveProperty('ride'); // not their ride: no snapshot
    const [row] = await db().query<{ driver_id: string }[]>('SELECT driver_id FROM rides WHERE id = $1', [ride.id]);
    expect(row.driver_id).toBe(first.id);
  });

  it('gives the assigned driver the current snapshot on a repeat accept', async () => {
    const ride = await searchingRide();
    const driver = await verifiedDriver();
    await accept(driver, ride.id).expect(200);
    const again = await accept(driver, ride.id);
    expect(again.status).toBe(HttpStatus.CONFLICT);
    expect(again.body).toMatchObject({ code: 'INVALID_TRANSITION', ride: { id: ride.id, status: 'driver_assigned', version: 2 } });
  });

  it('is 409 for a driver with a different vehicle type', async () => {
    const ride = await searchingRide();
    expect((await accept(await verifiedDriver('moto'), ride.id)).status).toBe(HttpStatus.CONFLICT);
  });

  it('allows one active ride per driver', async () => {
    const [r1, r2] = [await searchingRide(), await searchingRide()];
    const driver = await verifiedDriver();
    await accept(driver, r1.id).expect(200);
    const res = await accept(driver, r2.id);
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ message: 'Driver already has an active ride' });
  });

  it("never lets a driver accept their own ride", async () => {
    const user = await signIn(app);
    const ride = (await book(user, (await newQuote(user)).id).expect(201)).body as Ride;
    expect((await accept(await verifiedDriver('remork', user), ride.id)).status).toBe(HttpStatus.CONFLICT);
  });

  it('is 404 for an unknown ride and 400 for a malformed id', async () => {
    const driver = await verifiedDriver();
    expect((await accept(driver, randomUUID())).status).toBe(HttpStatus.NOT_FOUND);
    expect((await accept(driver, 'nope')).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('is 403 for a rider and for an unverified driver, and leaves the ride searching', async () => {
    const ride = await searchingRide();
    const rider = await signIn(app);
    expect((await accept(rider, ride.id)).status).toBe(HttpStatus.FORBIDDEN);
    const pending = await verifiedDriver();
    await db().query(`UPDATE drivers SET verification = 'pending' WHERE user_id = $1`, [pending.id]);
    expect((await accept(pending, ride.id)).status).toBe(HttpStatus.FORBIDDEN);
    const [row] = await db().query<{ status: string }[]>('SELECT status FROM rides WHERE id = $1', [ride.id]);
    expect(row.status).toBe('searching');
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
});
