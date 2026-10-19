import { Body, Controller, type INestApplication, Module, Post, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import type { ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { httpLoggerOptions } from './http-logger';

@Controller()
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown, @Res({ passthrough: true }) res: ServerResponse): unknown {
    res.setHeader('set-cookie', 'session=cookie-s3cret-out');
    return body;
  }
}

let app: INestApplication<App>;
let logs = '';

beforeAll(async () => {
  const sink = new Writable({ write: (chunk: Buffer, _enc, done) => ((logs += chunk.toString()), done()) });
  @Module({
    imports: [LoggerModule.forRoot({ pinoHttp: [httpLoggerOptions('info'), sink] })],
    controllers: [EchoController],
  })
  class TestModule {}
  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = await moduleRef.createNestApplication<INestApplication<App>>().init();
});

afterAll(() => app.close());

it('logs the request but never credentials from headers, cookies or the body', async () => {
  await request(app.getHttpServer())
    .post('/echo')
    .set('authorization', 'Bearer jwt-s3cret')
    .set('cookie', 'session=cookie-s3cret-in')
    .send({ refreshToken: 'refresh-s3cret' })
    .expect(201);

  expect(logs).toContain('request completed');
  expect(logs).toContain('[Redacted]');
  expect(logs).not.toMatch(/s3cret/);
});
