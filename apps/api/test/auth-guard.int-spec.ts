import { Controller, Get, HttpStatus, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Roles } from '../src/auth/auth.decorators';
import { bootApp, signIn, uniquePhone } from './support/actors';

type Tokens = { accessToken: string; refreshToken: string };

// Probe routes: no real driver/admin endpoint exists yet, and the guard is global, so it applies here too
@Controller('probe')
class ProbeController {
  @Get('driver')
  @Roles('driver')
  driver(): string {
    return 'ok';
  }

  @Get('admin')
  @Roles('admin')
  admin(): string {
    return 'ok';
  }
}

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const login = async (to?: string) => (await signIn(app, to)).tokens;
const me = (token?: string) => {
  const req = http().get('/me');
  return token ? req.set('authorization', `Bearer ${token}`) : req;
};
const sql = (query: string, params: unknown[]) => app.get(DataSource).query(query, params);

beforeAll(async () => {
  app = await (await bootApp({ controllers: [ProbeController] })).init();
});

afterAll(() => app.close());

describe('GET /me', () => {
  it('returns the caller, who signed up as a rider', async () => {
    const to = await uniquePhone(app);
    const res = await me((await login(to)).accessToken);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ id: expect.any(String) as string, phone: to, roles: ['rider'] });
  });

  it('is 401 without a token, or with one that is malformed, expired, forged or unsigned', async () => {
    const { accessToken } = await login();
    const { sub } = app.get(JwtService).decode<{ sub: string }>(accessToken);
    const [header, payload] = accessToken.split('.');
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    const forged = new JwtService({ secret: 'x'.repeat(32) }).sign({ sub, roles: ['admin'] });
    const expired = app.get(JwtService).sign({ sub, roles: ['rider'] }, { expiresIn: -10 });

    expect((await me()).status).toBe(HttpStatus.UNAUTHORIZED);
    for (const bad of ['garbage', `${header}.${payload}`, unsigned, forged, expired]) {
      expect((await me(bad)).status).toBe(HttpStatus.UNAUTHORIZED);
    }
    expect((await http().get('/me').set('authorization', accessToken)).status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('@Roles', () => {
  it('is 403 for a role the caller lacks; a granted role shows up after the next refresh', async () => {
    const to = await uniquePhone(app);
    const first = await login(to);
    const asDriver = (t: Tokens) => http().get('/probe/driver').set('authorization', `Bearer ${t.accessToken}`);
    expect((await asDriver(first)).status).toBe(HttpStatus.FORBIDDEN);

    await sql(`INSERT INTO user_roles (user_id, role) SELECT id, 'driver' FROM users WHERE phone = $1`, [to]);
    const refreshed = (await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200))
      .body as Tokens;

    expect((await asDriver(refreshed)).status).toBe(HttpStatus.OK);
    expect((await me(refreshed.accessToken)).body).toMatchObject({ roles: ['driver', 'rider'] });
    const asAdmin = await http().get('/probe/admin').set('authorization', `Bearer ${refreshed.accessToken}`);
    expect(asAdmin.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('does not give back a removed rider role on the next login', async () => {
    const to = await uniquePhone(app);
    await login(to);
    await sql(`DELETE FROM user_roles WHERE role = 'rider' AND user_id = (SELECT id FROM users WHERE phone = $1)`, [to]);
    expect((await me((await login(to)).accessToken)).body).toMatchObject({ roles: [] });
  });
});
