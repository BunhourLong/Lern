import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { type Config, parseEnv } from '../src/config';

async function boot(overrides: Partial<Config> = {}): Promise<INestApplication<App>> {
  const config = { ...parseEnv(process.env), LOG_LEVEL: 'silent' as const, ...overrides };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  return moduleRef.createNestApplication<INestApplication<App>>({ logger: false }).init();
}

it('is 200 when Postgres and Redis are up', async () => {
  const app = await boot();
  try {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
  } finally {
    await app.close();
  }
});

it('is 503 within the timeout when Redis is unreachable', async () => {
  const app = await boot({ REDIS_URL: 'redis://127.0.0.1:1' });
  try {
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'up', redis: 'down' });
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    await app.close();
  }
});

it('is 503 when the database connection is gone', async () => {
  const app = await boot();
  try {
    await app.get(DataSource).destroy();
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down', redis: 'up' });
  } finally {
    await app.close();
  }
});
