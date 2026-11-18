import type { Quote } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import { once } from 'node:events';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { haversineMeters } from '../src/pricing/domain/distance';
import { fare } from '../src/pricing/domain/fare';
import { bootApp, signIn } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

// Independence Monument → Phnom Penh airport, ~9.1 km straight line
const trip = { pickup: { lat: 11.5564, lng: 104.9282 }, dropoff: { lat: 11.5466, lng: 104.8441 }, vehicleType: 'moto' };
// perMin > 0, so the trip duration shows in the price (the seeded cards charge nothing per minute)
const card = { base: 5000, perKm: 1700, perMin: 300, minimumFare: 0, bookingFee: 500 };
// Non-integers, as OSRM sends them: fare() refuses them unrounded
const road = { distance: 3820.4, duration: 1380.6 };

type Mode = 'ok' | 'error500' | 'noRoute' | 'malformed' | 'tooLong' | 'redirect' | 'hang';
let mode: Mode;
let lastUrl: URL | undefined;
let osrm: Server;
let app: INestApplication<App>; // OSRM = the fake below
let down: INestApplication<App>; // OSRM = nothing listening
const db = () => app.get(DataSource);

// Local stand-in for OSRM's route service
beforeAll(async () => {
  osrm = createServer((req, res) => {
    lastUrl = new URL(req.url!, 'http://osrm');
    if (mode === 'hang') return;
    const reply = (status: number, json: object) => res.writeHead(status).end(JSON.stringify(json));
    // Each failure but the status keeps a usable route in the body, so only its own check refuses it
    if (mode === 'error500') return reply(500, { code: 'Ok', routes: [road] });
    if (mode === 'noRoute') return reply(200, { code: 'NoRoute', routes: [road] });
    if (mode === 'malformed') return reply(200, { code: 'Ok', routes: [{ distance: 'far', duration: road.duration }] });
    // One metre past quotes.distance_m's integer range
    if (mode === 'tooLong') return reply(200, { code: 'Ok', routes: [{ distance: 2_147_483_648, duration: road.duration }] });
    if (mode === 'redirect' && lastUrl.pathname !== '/moved') return res.writeHead(302, { location: '/moved' }).end();
    reply(200, { code: 'Ok', routes: [road] });
  }).listen(0, '127.0.0.1');
  await once(osrm, 'listening');
  const DATABASE_URL = await isolatedDatabase(); // own database: the card below would re-price other suites' quotes
  app = await (await bootApp({}, { DATABASE_URL, OSRM_URL: `http://127.0.0.1:${(osrm.address() as AddressInfo).port}` })).init();
  down = await (await bootApp({}, { DATABASE_URL })).init();
  await db().query(
    `INSERT INTO rate_cards (vehicle_type, base, per_km, per_min, minimum_fare, booking_fee, commission_bp, active_from)
     VALUES ('moto', $1, $2, $3, $4, $5, 1500, now() - interval '1 minute')`,
    [card.base, card.perKm, card.perMin, card.minimumFare, card.bookingFee],
  );
});
beforeEach(() => {
  mode = 'ok';
  lastUrl = undefined;
});
afterAll(async () => {
  await Promise.all([app?.close(), down?.close()]);
  osrm.closeAllConnections();
  osrm.close();
});

const quote = async (via: INestApplication<App>) => {
  const rider = await signIn(via);
  return (await request(via.getHttpServer()).post('/quotes').set(rider.auth).send(trip).expect(201)).body as Quote;
};
const row = async (q: Quote) =>
  (await db().query<{ distance_m: number; duration_s: number }[]>('SELECT distance_m, duration_s FROM quotes WHERE id = $1', [q.id]))[0];

it('prices a quote from the OSRM road distance and duration, rounded to whole metres and seconds, and stores both', async () => {
  const q = await quote(app);
  expect(q.distanceM).toBe(3820);
  expect(q.fare).toEqual(fare(card, { distanceM: 3820, durationS: 1381 }, 10_000).fare);
  expect(await row(q)).toEqual({ distance_m: 3820, duration_s: 1381 });
});

it('asks OSRM for the driving route from pickup to dropoff as lng,lat pairs, without geometry', async () => {
  await quote(app);
  expect(lastUrl?.pathname).toBe('/route/v1/driving/104.9282,11.5564;104.8441,11.5466');
  expect(lastUrl?.searchParams.get('overview')).toBe('false');
});

describe('OSRM failing', () => {
  const distanceM = haversineMeters(trip.pickup, trip.dropoff);
  const durationS = Math.round(distanceM / 5);

  it.each<[string, Mode | 'refused']>([
    ['connection refused', 'refused'],
    ['HTTP 500', 'error500'],
    ['code NoRoute', 'noRoute'],
    ['a malformed body', 'malformed'],
    ['a distance past the integer column', 'tooLong'],
    ['a redirect, even to a usable route', 'redirect'],
    ['no answer within 2 s', 'hang'],
  ])('quotes from the straight line at 5 m/s on %s', async (_, failure) => {
    if (failure !== 'refused') mode = failure;
    const q = await quote(failure === 'refused' ? down : app);
    expect(q.distanceM).toBe(distanceM);
    expect(q.fare).toEqual(fare(card, { distanceM, durationS }, 10_000).fare);
    expect(await row(q)).toEqual({ distance_m: distanceM, duration_s: durationS });
  });
});
