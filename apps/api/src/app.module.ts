import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DynamicModule, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import type { Config } from './config';
import { dataSourceOptions } from './database';
import { HealthController } from './health.controller';

// Client ids end up in every log line, so only short plain tokens are trusted
const SAFE_ID = /^[\w-]{1,128}$/;

function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

function createRedis(url: string): Redis {
  // ioredis waits this long for a socket that is already dead (Redis down) before letting the process exit
  const redis = new Redis(url, { disconnectTimeout: 200 });
  // Without a listener ioredis prints every reconnect failure; /health reports the outage
  redis.on('error', (err: Error) => new Logger('Redis').warn(err.message));
  return redis;
}

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({ pinoHttp: { level: config.LOG_LEVEL, genReqId: requestId } }),
        TypeOrmModule.forRoot(dataSourceOptions(config.DATABASE_URL)),
      ],
      controllers: [HealthController],
      providers: [{ provide: Redis, useFactory: () => createRedis(config.REDIS_URL) }],
    };
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
