import { DynamicModule, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

function createRedis(url: string): Redis {
  // ioredis waits this long for a socket that is already dead (Redis down) before letting the process exit
  const redis = new Redis(url, { disconnectTimeout: 200 });
  // Without a listener ioredis prints every reconnect failure; /health reports the outage
  redis.on('error', (err: Error) => new Logger('Redis').warn(err.message));
  return redis;
}

// Global: one shared client, injected by its class (`constructor(private readonly redis: Redis)`)
@Module({})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  static forRoot(url: string): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      providers: [{ provide: Redis, useFactory: () => createRedis(url) }],
      exports: [Redis],
    };
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
