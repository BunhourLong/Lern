import type { Point, Quote, Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { MatchingRepository } from '../src/matching/matching.repository';
import { MatchingService } from '../src/matching/matching.service';
import { type Actor, bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';
import { offer } from './support/offers';

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);

// Own database: the report counts every ride in its window
beforeAll(async () => {
  app = await (await bootApp({}, { DATABASE_URL: await isolatedDatabase() })).init();
});
afterAll(() => app.close());

const quay: Point = { lat: 11.5564, lng: 104.9282 };
const book = async (rider: Actor) => {
  const trip = { pickup: quay, dropoff: { lat: quay.lat - 0.01, lng: quay.lng - 0.01 }, vehicleType: 'remork' };
  const quote = (await http().post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
  return (await http().post('/rides').set(rider.auth).send({ quoteId: quote.id }).expect(201)).body as Ride;
};
const verifiedDriver = async () => {
  const me = await signIn(app);
  await http().post('/drivers/me').set(me.auth).send({ vehicleType: 'remork', plate: 'PP 2A-1234' }).expect(201);
  await db().query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [me.id]);
  return signIn(app, me.phone);
};

it('reports the matching funnel, time-to-match and offer outcomes of the rides booked in the window', async () => {
  const [d1, d2, d3] = [await verifiedDriver(), await verifiedDriver(), await verifiedDriver()];

  // A: declined by d1, accepted by d2, matched 20 s after booking
  const a = await book(await signIn(app));
  const declined = await offer(app, d1, a.id);
  await http().post(`/offers/${declined}/decline`).set(d1.auth).expect(200);
  const accepted = await offer(app, d2, a.id);
  await http().post(`/offers/${accepted}/accept`).set(d2.auth).expect(200);
  await db().query(
    `UPDATE rides SET created_at = (SELECT created_at FROM ride_events WHERE ride_id = $1 AND status = 'driver_assigned') - interval '20 seconds'
     WHERE id = $1`,
    [a.id],
  );

  // B: d3 lets the offer expire, then the search deadline passes
  const b = await book(await signIn(app));
  const silent = await offer(app, d3, b.id);
  await db().query(`UPDATE ride_offers SET expires_at = now() - interval '1 millisecond' WHERE id = $1`, [silent]);
  await app.get(MatchingService).expire(silent);
  await db().query(`UPDATE rides SET created_at = now() - interval '91 seconds' WHERE id = $1`, [b.id]);
  await app.get(MatchingService).sync(b.id);

  // C: the rider gives up while it searches
  const riderC = await signIn(app);
  const c = await book(riderC);
  await http().post(`/rides/${c.id}/cancel`).set(riderC.auth).send({ reason: 'changed_mind' }).expect(200);

  // D: booked before the window
  const d = await book(await signIn(app));
  await db().query(`UPDATE rides SET created_at = now() - interval '2 hours' WHERE id = $1`, [d.id]);

  expect(await new MatchingRepository(db()).stats(3600)).toEqual({
    booked: 3,
    matched: 1,
    noDriverFound: 1,
    cancelledSearching: 1,
    timeToMatchS: { p50: 20, p95: 20 },
    offersPerMatchedRide: 2,
    offers: { accepted: 1, declined: 1, expired: 1 },
  });
});

it('reports zeros and no time-to-match for an empty window', async () => {
  expect(await new MatchingRepository(db()).stats(0)).toEqual({
    booked: 0,
    matched: 0,
    noDriverFound: 0,
    cancelledSearching: 0,
    timeToMatchS: null,
    offersPerMatchedRide: null,
    offers: { accepted: 0, declined: 0, expired: 0 },
  });
});
