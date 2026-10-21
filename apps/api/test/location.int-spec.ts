import type { LocationPoint } from '@lern/contracts';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { type Actor, bootApp, signIn } from './support/actors';

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
