import { Controller, Get, HttpStatus, type INestApplication, Module } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DriversModule } from '../src/drivers/drivers.module';
import { VerifiedDriver } from '../src/drivers/verified-driver.guard';
import { bootApp, signIn } from './support/actors';

type Tokens = { accessToken: string; refreshToken: string };

// No driver-operational endpoint exists until M3 (go online), so a probe stands in for one
@Controller('probe')
class ProbeController {
  @Get('verified-driver')
  @VerifiedDriver()
  verified(): string {
    return 'ok';
  }
}

@Module({ imports: [DriversModule], controllers: [ProbeController] })
class ProbeModule {}

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const auth = (t: Tokens) => ({ authorization: `Bearer ${t.accessToken}` });
const login = async () => (await signIn(app)).tokens;
const refresh = async (t: Tokens) =>
  (await http().post('/auth/refresh').send({ refreshToken: t.refreshToken }).expect(200)).body as Tokens;
const apply = (t: Tokens, body: object = { vehicleType: 'remork', plate: 'PP 2A-1234' }) =>
  http().post('/drivers/me').set(auth(t)).send(body);
const setVerification = async (t: Tokens, status: string) => {
  const { id } = (await http().get('/me').set(auth(t))).body as { id: string };
  await app.get(DataSource).query('UPDATE drivers SET verification = $2 WHERE user_id = $1', [id, status]);
};

beforeAll(async () => {
  app = await (await bootApp({ imports: [ProbeModule] })).init();
});

afterAll(() => app.close());

describe('POST /drivers/me', () => {
  it('creates a pending profile and grants the driver role, which the next token carries', async () => {
    const rider = await login();
    const res = await apply(rider);
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ vehicleType: 'remork', plate: 'PP 2A-1234', verification: 'pending', availability: 'offline' });
    expect((await http().get('/drivers/me').set(auth(rider))).body).toEqual(res.body);
    const driver = await refresh(rider);
    const { roles } = (await http().get('/me').set(auth(driver))).body as { roles: string[] };
    expect(roles).toEqual(['driver', 'rider']);
  });

  it('lets a user apply once, even with parallel requests', async () => {
    const rider = await login();
    const statuses = (await Promise.all([apply(rider), apply(rider)])).map((r) => r.status).sort();
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT]);
    expect((await apply(rider)).status).toBe(HttpStatus.CONFLICT);
  });

  it('rejects an unknown vehicle type or empty plate, and anonymous callers', async () => {
    const rider = await login();
    expect((await apply(rider, { vehicleType: 'car', plate: 'PP 1' })).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await apply(rider, { vehicleType: 'moto', plate: '  ' })).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await http().post('/drivers/me').send({ vehicleType: 'moto', plate: 'PP 1' })).status).toBe(
      HttpStatus.UNAUTHORIZED,
    );
  });

  it('is 404 on GET for a user who never applied', async () => {
    const rider = await login();
    expect((await http().get('/drivers/me').set(auth(rider))).status).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('@VerifiedDriver', () => {
  const probe = (t: Tokens) => http().get('/probe/verified-driver').set(auth(t));

  it('admits only verified drivers, and a suspension or ban applies at once without a new token', async () => {
    const driver = await login();
    await apply(driver).expect(HttpStatus.CREATED);
    const tokens = await refresh(driver);

    const pending = await probe(tokens);
    expect(pending.status).toBe(HttpStatus.FORBIDDEN);
    expect(pending.body).toMatchObject({ verification: 'pending' });

    await setVerification(tokens, 'verified');
    expect((await probe(tokens)).status).toBe(HttpStatus.OK);

    for (const status of ['suspended', 'banned']) {
      await setVerification(tokens, status);
      const res = await probe(tokens);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      expect(res.body).toMatchObject({ verification: status });
    }
  });

  it('is 403 for a rider who is not a driver', async () => {
    const rider = await login();
    expect((await probe(rider)).status).toBe(HttpStatus.FORBIDDEN);
  });
});

describe('PUT /drivers/me/availability', () => {
  const put = (t: Tokens, body: object) => http().put('/drivers/me/availability').set(auth(t)).send(body);
  const driver = async (verification = 'verified') => {
    const rider = await login();
    await apply(rider).expect(HttpStatus.CREATED);
    const tokens = await refresh(rider);
    await setVerification(tokens, verification);
    return tokens;
  };
  const stored = async (t: Tokens) => ((await http().get('/drivers/me').set(auth(t))).body as { availability: string }).availability;

  it('starts offline, goes online and offline, and repeating a state changes nothing', async () => {
    const t = await driver();
    expect(await stored(t)).toBe('offline');
    for (const [online, availability] of [[true, 'available'], [true, 'available'], [false, 'offline'], [false, 'offline']] as const) {
      const res = await put(t, { online });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({ availability });
      expect(await stored(t)).toBe(availability);
    }
  });

  it.each(['pending', 'suspended'])('keeps a %s driver offline, but lets them go offline', async (verification) => {
    const t = await driver('verified');
    await put(t, { online: true }).expect(HttpStatus.OK);
    await setVerification(t, verification);
    await put(t, { online: false }).expect(HttpStatus.OK);
    const res = await put(t, { online: true });
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
    expect(res.body).toMatchObject({ verification });
    expect(await stored(t)).toBe('offline');
  });

  it('is 409 with the current state while reserved or on a trip, and changes nothing', async () => {
    const t = await driver();
    const { id } = (await http().get('/me').set(auth(t))).body as { id: string };
    for (const state of ['reserved', 'on_trip']) {
      await app.get(DataSource).query('UPDATE drivers SET availability = $2 WHERE user_id = $1', [id, state]);
      for (const online of [true, false]) {
        const res = await put(t, { online });
        expect(res.status).toBe(HttpStatus.CONFLICT);
        expect(res.body).toMatchObject({ availability: state });
      }
      expect(await stored(t)).toBe(state);
    }
  });

  it('is 404 for a non-driver, 400 for a bad body and 401 without a token', async () => {
    expect((await put(await login(), { online: false })).status).toBe(HttpStatus.NOT_FOUND);
    expect((await put(await driver(), { online: 'yes' })).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await http().put('/drivers/me/availability').send({ online: true })).status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

// IDOR template (see test/support/actors.ts): A owns, B probes; B must see 404 (no hint that A's data exists)
describe('ownership', () => {
  it("never lets one user read or write another user's driver profile", async () => {
    const [a, b] = [await signIn(app), await signIn(app)];
    await apply(a.tokens).expect(HttpStatus.CREATED);
    expect((await http().get('/drivers/me').set(b.auth)).status).toBe(HttpStatus.NOT_FOUND);

    // A userId smuggled into the body is stripped by the schema; the caller always comes from the token
    const smuggled = await http()
      .post('/drivers/me')
      .set(b.auth)
      .send({ userId: a.id, vehicleType: 'moto', plate: 'PP 9Z-9999' });
    expect(smuggled.status).toBe(HttpStatus.CREATED);
    expect((await http().get('/drivers/me').set(a.auth)).body).toMatchObject({ vehicleType: 'remork' });
    expect((await http().get('/drivers/me').set(b.auth)).body).toMatchObject({ vehicleType: 'moto' });
  });
});
