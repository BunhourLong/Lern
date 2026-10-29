import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { DriversModule } from './drivers/drivers.module';
import { HealthModule } from './health/health.module';
import { LocationModule } from './location/location.module';
import { MatchingModule } from './matching/matching.module';
import { PricingModule } from './pricing/pricing.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RidesModule } from './rides/rides.module';
import type { Config } from './shared/config/env';
import { dataSourceOptions } from './shared/database/database';
import { httpLoggerOptions } from './shared/logging/http-logger';
import { QueueModule } from './shared/queue/queue.module';
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
        QueueModule.forRoot(config.QUEUE_PREFIX),
        HealthModule,
        AuthModule.forRoot(config),
        DriversModule,
        LocationModule,
        MatchingModule.forRoot(config),
        PricingModule,
        RidesModule,
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
