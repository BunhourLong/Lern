import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { parseEnv } from '../src/shared/config/env';

let app: INestApplication<App>;
let url: string;
let nextPhone = 0;
// Own number range: test files share one database
const phone = () => `+8553${String(nextPhone++).padStart(7, '0')}`;
const login = async () =>
  (
    (await request(app.getHttpServer()).post('/auth/otp/verify').send({ phone: phone(), code: '000000' }).expect(200))
      .body as { accessToken: string }
  ).accessToken;

const sockets: Socket[] = [];
const connect = (token?: string) => {
  const socket = io(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  return socket;
};
// Resolves with how the handshake ended: 'connect' or the server's error message
const handshake = (socket: Socket) =>
  new Promise<string>((resolve) => {
    socket.once('connect', () => resolve('connect'));
    socket.once('connect_error', (err) => resolve(err.message));
  });

beforeAll(async () => {
  const config = { ...parseEnv(process.env), LOG_LEVEL: 'silent' as const };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
afterAll(() => app.close());

it('refuses the handshake without a valid access token', async () => {
  const token = await login();
  const { sub } = app.get(JwtService).decode<{ sub: string }>(token);
  const forged = new JwtService({ secret: 'x'.repeat(32) }).sign({ sub, roles: ['admin'] });
  const expired = app.get(JwtService).sign({ sub, roles: ['rider'] }, { expiresIn: -10 });

  for (const bad of [undefined, 'garbage', forged, expired]) {
    expect(await handshake(connect(bad))).toBe('Unauthorized');
  }
});

it('connects with an access token and receives events sent to its user room', async () => {
  const token = await login();
  const socket = connect(token);
  expect(await handshake(socket)).toBe('connect');

  const { sub } = app.get(JwtService).decode<{ sub: string }>(token);
  const received = new Promise((resolve) => socket.once('ping', resolve));
  app.get(RealtimeGateway).server.to(`user:${sub}`).emit('ping', { ok: true });
  expect(await received).toEqual({ ok: true });
});

it('disconnects a socket when its access token expires', async () => {
  const { sub } = app.get(JwtService).decode<{ sub: string }>(await login());
  const socket = connect(app.get(JwtService).sign({ sub, roles: ['rider'] }, { expiresIn: 1 }));
  expect(await handshake(socket)).toBe('connect');
  const reason = await new Promise((resolve) => socket.once('disconnect', resolve));
  expect(reason).toBe('io server disconnect');
});

it('knows the caller in message handlers (auth happened once, at the handshake)', async () => {
  const token = await login();
  const socket = connect(token);
  expect(await handshake(socket)).toBe('connect');
  const { sub } = app.get(JwtService).decode<{ sub: string }>(token);
  expect(await socket.emitWithAck('whoami')).toEqual({ id: sub, roles: ['rider'] });
});
