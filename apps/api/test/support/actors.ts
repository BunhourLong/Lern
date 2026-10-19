import type { TokenPair } from '@lern/contracts';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { parseEnv } from '../../src/shared/config/env';

// The real app plus test-only modules/controllers (probe routes); call .init() or .listen() on the result
export async function bootApp(extra: Pick<ModuleMetadata, 'imports' | 'controllers'> = {}) {
  const config = { ...parseEnv(process.env), LOG_LEVEL: 'silent' as const };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(extra.imports ?? [])],
    controllers: extra.controllers,
  }).compile();
  return moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
}

// A counter in the shared test Redis: unique across files and Jest workers, so no two tests share a
// user or a per-phone rate-limit window
export async function uniquePhone(app: INestApplication<App>): Promise<string> {
  const n = await app.get(Redis).incr('test:phone-seq');
  return `+8551${String(n).padStart(7, '0')}`;
}

export type Actor = { id: string; phone: string; tokens: TokenPair; auth: { authorization: string } };

// Signs in through the real OTP flow (dev provider's fixed code).
// IDOR template: sign in two actors, let A own something, and assert B can neither see nor change it.
export async function signIn(app: INestApplication<App>, phone?: string): Promise<Actor> {
  const to = phone ?? (await uniquePhone(app));
  const res = await request(app.getHttpServer()).post('/auth/otp/verify').send({ phone: to, code: '000000' });
  if (res.status !== 200) throw new Error(`sign-in failed with ${res.status}`);
  const tokens = res.body as TokenPair;
  const { sub } = app.get(JwtService).decode<{ sub: string }>(tokens.accessToken);
  return { id: sub, phone: to, tokens, auth: { authorization: `Bearer ${tokens.accessToken}` } };
}
