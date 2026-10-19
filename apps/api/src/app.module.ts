import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { DriversModule } from './drivers/drivers.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import type { Config } from './shared/config/env';
import { dataSourceOptions } from './shared/database/database';
import { httpLoggerOptions } from './shared/logging/http-logger';
import { RedisModule } from './shared/redis/redis.module';

// Composition only: wires infrastructure and feature modules, holds no logic
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(config.LOG_LEVEL) }),
        TypeOrmModule.forRoot(dataSourceOptions(config.DATABASE_URL)),
        RedisModule.forRoot(config.REDIS_URL),
        HealthModule,
        AuthModule.forRoot(config),
        DriversModule,
        RealtimeModule,
      ],
      // Request DTOs are validated, and @ZodSerializerDto responses checked, against packages/contracts
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
    };
  }
}
