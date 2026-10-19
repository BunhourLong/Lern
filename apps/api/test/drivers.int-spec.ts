import { Controller, Get, HttpStatus, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DriversModule } from '../src/drivers/drivers.module';
import { VerifiedDriver } from '../src/drivers/verified-driver.guard';
import { parseEnv } from '../src/shared/config/env';

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
let nextPhone = 0;
// Own number range: test files share one database
const phone = () => `+8556${String(nextPhone++).padStart(7, '0')}`;
const http = () => request(app.getHttpServer());
const auth = (t: Tokens) => ({ authorization: `Bearer ${t.accessToken}` });
const login = async () =>
  (await http().post('/auth/otp/verify').send({ phone: phone(), code: '000000' }).expect(200)).body as Tokens;
const refresh = async (t: Tokens) =>
  (await http().post('/auth/refresh').send({ refreshToken: t.refreshToken }).expect(200)).body as Tokens;
const apply = (t: Tokens, body: object = { vehicleType: 'remork', plate: 'PP 2A-1234' }) =>
  http().post('/drivers/me').set(auth(t)).send(body);
const setVerification = async (t: Tokens, status: string) => {
  const { id } = (await http().get('/me').set(auth(t))).body as { id: string };
  await app.get(DataSource).query('UPDATE drivers SET verification = $2 WHERE user_id = $1', [id, status]);
};

beforeAll(async () => {
  const config = { ...parseEnv(process.env), LOG_LEVEL: 'silent' as const };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config), ProbeModule] }).compile();
  app = await moduleRef.createNestApplication<INestApplication<App>>({ logger: false }).init();
});

afterAll(() => app.close());

describe('POST /drivers/me', () => {
  it('creates a pending profile and grants the driver role, which the next token carries', async () => {
    const rider = await login();
    const res = await apply(rider);
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ vehicleType: 'remork', plate: 'PP 2A-1234', verification: 'pending' });
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
