import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Config } from '../src/shared/config/env';
import { bootApp } from './support/actors';

const ios = { minVersion: '1.4.2', storeUrl: 'https://apps.apple.com/app/id123456789' };
const android = { minVersion: '2.0', storeUrl: 'https://play.google.com/store/apps/details?id=com.lern.app' };

// Every key explicit: the dev env must not decide what the app is told at boot
const unset: Partial<Config> = {
  APP_MIN_VERSION_IOS: undefined,
  APP_STORE_URL_IOS: undefined,
  APP_MIN_VERSION_ANDROID: undefined,
  APP_STORE_URL_ANDROID: undefined,
  MAINTENANCE: false,
  KHR_PER_USD: 4000,
};

async function boot(overrides: Partial<Config>): Promise<INestApplication<App>> {
  return (await bootApp({}, overrides)).init();
}

it('is public and reports no minimum versions when none are configured', async () => {
  const app = await boot(unset);
  try {
    const res = await request(app.getHttpServer()).get('/app-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maintenance: false, ios: null, android: null, khrPerUsd: 4000 });
  } finally {
    await app.close();
  }
});

it('reports the riel-per-dollar display rate from config', async () => {
  const app = await boot({ ...unset, KHR_PER_USD: 4100 });
  try {
    const res = await request(app.getHttpServer()).get('/app-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maintenance: false, ios: null, android: null, khrPerUsd: 4100 });
  } finally {
    await app.close();
  }
});

it('reports both platforms and maintenance mode', async () => {
  const app = await boot({
    ...unset,
    MAINTENANCE: true,
    APP_MIN_VERSION_IOS: ios.minVersion,
    APP_STORE_URL_IOS: ios.storeUrl,
    APP_MIN_VERSION_ANDROID: android.minVersion,
    APP_STORE_URL_ANDROID: android.storeUrl,
  });
  try {
    const res = await request(app.getHttpServer()).get('/app-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maintenance: true, ios, android, khrPerUsd: 4000 });
  } finally {
    await app.close();
  }
});

it('reports only the platform that has a minimum version', async () => {
  const app = await boot({
    ...unset,
    APP_MIN_VERSION_ANDROID: android.minVersion,
    APP_STORE_URL_ANDROID: android.storeUrl,
  });
  try {
    const res = await request(app.getHttpServer()).get('/app-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maintenance: false, ios: null, android, khrPerUsd: 4000 });
  } finally {
    await app.close();
  }
});
