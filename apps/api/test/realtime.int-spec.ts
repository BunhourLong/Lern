import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import type { App } from 'supertest/types';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { bootApp, signIn } from './support/actors';

let app: INestApplication<App>;
let url: string;
const login = async () => (await signIn(app)).tokens.accessToken;

const sockets: Socket[] = [];
const connect = (token?: string, at = url, transports = ['websocket']) => {
  const socket = io(at, { auth: token ? { token } : {}, transports, reconnection: false });
  sockets.push(socket);
  return socket;
};
// Resolves with how the handshake ended: 'connect' or the server's error message
const handshake = (socket: Socket) =>
  new Promise<string>((resolve) => {
    socket.once('connect', () => resolve('connect'));
    socket.once('connect_error', (err) => resolve(err.message));
  });
// Rejects instead of hanging the test when the event never arrives
const next = (socket: Socket, event: string) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within 2 s`)), 2000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  app = await bootApp();
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

it('delivers a user-room event emitted on another API instance (Redis adapter), to that user only', async () => {
  const other = await bootApp();
  await other.listen(0, '127.0.0.1');
  try {
    const [x, y] = [await login(), await login()];
    const [sx, sy] = [connect(x, await other.getUrl()), connect(y, await other.getUrl())];
    expect([await handshake(sx), await handshake(sy)]).toEqual(['connect', 'connect']);
    let yGot = false;
    sy.on('probe', () => (yGot = true));
    const received = next(sx, 'probe');

    const id = (token: string) => app.get(JwtService).decode<{ sub: string }>(token).sub;
    const server = app.get(RealtimeGateway).server;
    server.to(`user:${id(x)}`).emit('probe', { ok: true });
    expect(await received).toEqual({ ok: true });
    // Sent after the probe over the same pub connection, so once Y has it, a misrouted probe would have too
    const sentinel = next(sy, 'sentinel');
    server.to(`user:${id(y)}`).emit('sentinel');
    await sentinel;
    expect(yGot).toBe(false);
  } finally {
    sockets.splice(0).forEach((s) => s.disconnect());
    await other.close();
  }
});

it('accepts WebSocket only, so 2+ instances need no sticky sessions', async () => {
  const token = await login();
  expect(await handshake(connect(token, url, ['polling']))).not.toBe('connect');
  expect(await handshake(connect(token))).toBe('connect');
});

it('closes right after boot without unhandled rejections (the Redis adapter never awaits its commands)', async () => {
  const rejections: unknown[] = [];
  const record = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', record);
  try {
    // Closing mid-handshake leaves the adapter's SUBSCRIBEs queued; the close flushes them as rejections
    for (let i = 0; i < 5; i++) await (await (await bootApp()).init()).close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    process.off('unhandledRejection', record);
  }
  expect(rejections).toEqual([]);
});
