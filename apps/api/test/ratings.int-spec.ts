import type { Quote, Ride } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';
import { assign } from './support/offers';

// PLAN.md M6.10: a participant of a completed ride rates the other side once, within 7 days of completion
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5696, lng: 104.921 }, vehicleType: 'moto' as const };

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

beforeAll(async () => {
  app = await (await bootApp()).init();
});
afterAll(() => app.close());

const rate = (a: Actor, rideId: string, body: object) => http().post(`/rides/${rideId}/rating`).set(a.auth).send(body);
const step = (a: Actor, rideId: string, action: string) => http().post(`/rides/${rideId}/${action}`).set(a.auth);
const newDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'moto', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone); // a fresh token carries the driver role
};
const searchingRide = async (rider?: Actor): Promise<{ rider: Actor; ride: Ride }> => {
  const r = rider ?? (await signIn(app));
  const quote = (await http().post('/quotes').set(r.auth).send(trip).expect(201)).body as Quote;
  const ride = (await http().post('/rides').set(r.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
  return { rider: r, ride };
};
// A ride accepted by the driver and walked on with the driver's steps
const rideFor = async (driver: Actor, ...steps: string[]) => {
  const { rider, ride } = await searchingRide();
  await assign(app, driver, ride.id);
  for (const s of steps) await step(driver, ride.id, s).expect(200);
  return { rider, driver, ride };
};
const completedRide = async () => rideFor(await newDriver(), 'arrive', 'start', 'complete');
const ratings = (rideId: string) =>
  db().query<{ from_user: string; to_user: string; stars: number; comment: string | null }[]>(
    'SELECT from_user, to_user, stars, comment FROM ratings WHERE ride_id = $1 ORDER BY stars',
    [rideId],
  );

describe('POST /rides/:id/rating', () => {
  it('lets the rider rate the driver once, and stores who rated whom', async () => {
    const { rider, driver, ride } = await completedRide();
    const res = await rate(rider, ride.id, { stars: 5, comment: 'Great' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ rideId: ride.id, stars: 5, comment: 'Great' });
    expect(await ratings(ride.id)).toEqual([{ from_user: rider.id, to_user: driver.id, stars: 5, comment: 'Great' }]);
  });

  it('lets the driver rate the rider, and both sides can rate the same ride', async () => {
    const { rider, driver, ride } = await completedRide();
    await rate(rider, ride.id, { stars: 4 }).expect(201);
    const res = await rate(driver, ride.id, { stars: 3, comment: '  ' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ rideId: ride.id, stars: 3, comment: null }); // a blank comment is no comment
    expect(await ratings(ride.id)).toEqual([
      { from_user: driver.id, to_user: rider.id, stars: 3, comment: null },
      { from_user: rider.id, to_user: driver.id, stars: 4, comment: null },
    ]);
  });

  it('refuses a second rating from the same side and keeps the first', async () => {
    const { rider, ride } = await completedRide();
    await rate(rider, ride.id, { stars: 5, comment: 'Great' }).expect(201);
    const res = await rate(rider, ride.id, { stars: 1 });
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'ALREADY_RATED' });
    expect(await ratings(ride.id)).toEqual([expect.objectContaining({ stars: 5, comment: 'Great' })]);
  });

  it('answers 404 to a stranger and to an unknown ride, and 401 without a token', async () => {
    const { ride } = await completedRide();
    const stranger = await signIn(app);
    for (const res of [
      await rate(stranger, ride.id, { stars: 1 }),
      await rate(stranger, randomUUID(), { stars: 1 }),
    ]) {
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
      expect(res.body).toMatchObject({ message: 'Ride not found' });
    }
    expect((await http().post(`/rides/${ride.id}/rating`).send({ stars: 1 })).status).toBe(HttpStatus.UNAUTHORIZED);
    expect(await ratings(ride.id)).toEqual([]);
  });

  it('refuses a ride that is not completed yet', async () => {
    const { rider, ride } = await searchingRide();
    const res = await rate(rider, ride.id, { stars: 5 });
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'RIDE_NOT_COMPLETED' });

    const driver = await newDriver();
    const arrived = await rideFor(driver, 'arrive');
    expect((await rate(arrived.rider, arrived.ride.id, { stars: 5 })).body).toMatchObject({ code: 'RIDE_NOT_COMPLETED' });
    expect(await ratings(ride.id)).toEqual([]);
  });

  it('closes 7 days after completion', async () => {
    const closed = await completedRide();
    await db().query(
      `UPDATE ride_events SET created_at = now() - interval '7 days 1 minute' WHERE ride_id = $1 AND status = 'completed'`,
      [closed.ride.id],
    );
    const res = await rate(closed.rider, closed.ride.id, { stars: 5 });
    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'RATING_WINDOW_CLOSED' });

    const open = await completedRide();
    await db().query(
      `UPDATE ride_events SET created_at = now() - interval '6 days 23 hours' WHERE ride_id = $1 AND status = 'completed'`,
      [open.ride.id],
    );
    await rate(open.rider, open.ride.id, { stars: 5 }).expect(201);
  });

  it('says ALREADY_RATED, not RATING_WINDOW_CLOSED, to a re-rate after the window', async () => {
    const { rider, ride } = await completedRide();
    await rate(rider, ride.id, { stars: 5 }).expect(201);
    await db().query(
      `UPDATE ride_events SET created_at = now() - interval '8 days' WHERE ride_id = $1 AND status = 'completed'`,
      [ride.id],
    );
    expect((await rate(rider, ride.id, { stars: 1 })).body).toMatchObject({ code: 'ALREADY_RATED' });
  });

  it('validates the body: stars are whole numbers 1 to 5, the comment is at most 500 characters', async () => {
    const { rider, ride } = await completedRide();
    for (const body of [
      { stars: 0 },
      { stars: 6 },
      { stars: 4.5 },
      {},
      { stars: 5, comment: 'x'.repeat(501) },
      { stars: 5, comment: 'a\u0000b' }, // Postgres text can't hold NUL: must be a 400, not a 500
    ]) {
      expect((await rate(rider, ride.id, body)).status).toBe(HttpStatus.BAD_REQUEST);
    }
    await rate(rider, ride.id, { stars: 5, comment: 'x'.repeat(500) }).expect(201);
  });

  it('replays the original rating for the same Idempotency-Key, without a second row', async () => {
    const { rider, ride } = await completedRide();
    const key = randomUUID();
    const send = () => http().post(`/rides/${ride.id}/rating`).set(rider.auth).set('Idempotency-Key', key).send({ stars: 2 });
    const first = await send();
    const retry = await send();
    expect(first.status).toBe(HttpStatus.CREATED);
    expect(retry.status).toBe(HttpStatus.CREATED);
    expect(retry.body).toEqual(first.body);
    expect(await ratings(ride.id)).toHaveLength(1);
  });
});
