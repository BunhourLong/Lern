import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import type { Config } from './shared/config/env';
import { dataSourceOptions } from './shared/database/database';
import { requestId } from './shared/logging/request-id';
import { RedisModule } from './shared/redis/redis.module';

// Composition only: wires infrastructure and feature modules, holds no logic
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({ pinoHttp: { level: config.LOG_LEVEL, genReqId: requestId } }),
        TypeOrmModule.forRoot(dataSourceOptions(config.DATABASE_URL)),
        RedisModule.forRoot(config.REDIS_URL),
        HealthModule,
      ],
    };
  }
}
