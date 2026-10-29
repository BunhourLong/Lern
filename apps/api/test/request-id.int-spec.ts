import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { testConfig } from './support/actors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let app: INestApplication<App>;

beforeAll(async () => {
  const config = testConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
});

afterAll(() => app.close());

// No routes exist yet; a 404 still passes through the request-id middleware
const get = () => request(app.getHttpServer()).get('/');

it('echoes a well-formed incoming x-request-id', async () => {
  const res = await get().set('x-request-id', 'mobile-7f3a_01');
  expect(res.headers['x-request-id']).toBe('mobile-7f3a_01');
});

it('generates a UUID when the client sends none', async () => {
  expect((await get()).headers['x-request-id']).toMatch(UUID);
});

it('replaces an unsafe incoming id instead of logging it', async () => {
  for (const bad of ['x'.repeat(129), 'has spaces', '{"json":1}']) {
    expect((await get().set('x-request-id', bad)).headers['x-request-id']).toMatch(UUID);
  }
});
