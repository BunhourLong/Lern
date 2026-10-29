import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HealthService } from '../src/health/health.service';
import type { Config } from '../src/shared/config/env';
import { testConfig } from './support/actors';

async function boot(overrides: Partial<Config> = {}): Promise<INestApplication<App>> {
  const config = testConfig(overrides);
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

// Production defaults: the matching worker registers its schedulers at bootstrap, which must not wait for Redis
it('boots and is 503 when Redis is unreachable, with the matching worker on', async () => {
  const app = await boot({
    REDIS_URL: 'redis://127.0.0.1:1',
    MATCHING_WORKER: true,
    SWEEP_INTERVAL_MS: 5000,
    RECONCILE_INTERVAL_MS: 30000,
  });
  try {
    await request(app.getHttpServer()).get('/health').expect(503);
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

it('is 500 instead of leaking a body that breaks the health contract', async () => {
  const config = testConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(HealthService)
    .useValue({ check: () => Promise.resolve({ status: 'ok', db: 'maybe', redis: 'up' }) })
    .compile();
  const app = await moduleRef.createNestApplication<INestApplication<App>>({ logger: false }).init();
  try {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('db');
  } finally {
    await app.close();
  }
});
