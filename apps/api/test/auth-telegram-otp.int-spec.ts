import { HttpStatus, type INestApplication } from '@nestjs/common';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { OtpService } from '../src/auth/otp.service';
import { bootApp, uniquePhone } from './support/actors';

const TOKEN = 'test-gateway-token';
// TEST-NET-2 address: keeps this file out of the per-IP budget other files share on 127.0.0.1
const IP = '198.51.100.7';

type Call = { method: string; authorization?: string; body: Record<string, string | number> };

// Local stand-in for gatewayapi.telegram.org: same envelope, methods and statuses as the real API
const calls: Call[] = [];
const sentCodes = new Map<string, string>(); // request_id -> code "delivered" to the phone
const lastCode = (phone: string) => sentCodes.get(`req-${phone}`)!;
let failNextWith: string | undefined;
let gateway: Server;
let app: INestApplication<App>;

function startGateway(): Server {
  return createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Call['body'];
      calls.push({ method: req.url!.slice(1), authorization: req.headers.authorization, body });
      const reply = (status: number, json: object) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));

      if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { ok: false, error: 'ACCESS_TOKEN_INVALID' });
      if (failNextWith) {
        const error = failNextWith;
        failNextWith = undefined;
        return reply(400, { ok: false, error });
      }
      if (req.url === '/sendVerificationMessage') {
        const requestId = `req-${body.phone_number}`;
        sentCodes.set(requestId, String(100000 + sentCodes.size));
        return reply(200, { ok: true, result: { request_id: requestId, phone_number: body.phone_number, request_cost: 0.01 } });
      }
      if (req.url === '/checkVerificationStatus') {
        const status = sentCodes.get(String(body.request_id)) === body.code ? 'code_valid' : 'code_invalid';
        return reply(200, { ok: true, result: { request_id: body.request_id, verification_status: { status, updated_at: 0 } } });
      }
      reply(404, { ok: false, error: 'METHOD_NOT_FOUND' });
    });
  });
}

const verify = (phone: string, code: string) =>
  request(app.getHttpServer()).post('/auth/otp/verify').send({ phone, code });

beforeAll(async () => {
  gateway = startGateway().listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const url = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  app = await (
    await bootApp({}, { OTP_PROVIDER: 'telegram', TELEGRAM_GATEWAY_TOKEN: TOKEN, TELEGRAM_GATEWAY_URL: url })
  ).init();
});

beforeEach(() => (calls.length = 0));

afterAll(async () => {
  await app.close();
  gateway.close();
});

it('asks Telegram for a 6-digit, 5-minute code, authenticated with the token', async () => {
  const phone = await uniquePhone(app);
  await app.get(OtpService).request(phone, IP);
  expect(calls).toEqual([
    {
      method: 'sendVerificationMessage',
      authorization: `Bearer ${TOKEN}`,
      body: { phone_number: phone, code_length: 6, ttl: 300 },
    },
  ]);
});

it('signs in with the delivered code, once', async () => {
  const phone = await uniquePhone(app);
  await app.get(OtpService).request(phone, IP);

  expect((await verify(phone, '999999')).status).toBe(HttpStatus.UNAUTHORIZED);
  expect((await verify(phone, lastCode(phone))).status).toBe(HttpStatus.OK);
  expect(calls.at(-1)).toMatchObject({
    method: 'checkVerificationStatus',
    body: { request_id: `req-${phone}`, code: lastCode(phone) },
  });
  expect((await verify(phone, lastCode(phone))).status).toBe(HttpStatus.UNAUTHORIZED);
});

it('rejects a code for a number with no pending request, without calling Telegram', async () => {
  expect((await verify(await uniquePhone(app), '123456')).status).toBe(HttpStatus.UNAUTHORIZED);
  expect(calls).toEqual([]);
});

it('is 503 when Telegram refuses to send, and leaves nothing to verify', async () => {
  const phone = await uniquePhone(app);
  failNextWith = 'PHONE_NUMBER_INVALID';
  await expect(app.get(OtpService).request(phone, IP)).rejects.toMatchObject({
    status: HttpStatus.SERVICE_UNAVAILABLE,
  });
  expect((await verify(phone, '100000')).status).toBe(HttpStatus.UNAUTHORIZED);
});
