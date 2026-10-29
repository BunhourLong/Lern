import { DynamicModule, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { assertNoEviction } from './assert-no-eviction';
import { MatchingQueue } from './matching-queue';

// Global, like RedisModule: rides enqueues, matching enqueues and processes
@Module({})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly redis: Redis,
    private readonly queue: MatchingQueue,
  ) {}

  static forRoot(prefix: string): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      providers: [{ provide: MatchingQueue, inject: [Redis], useFactory: (redis: Redis) => new MatchingQueue(redis, prefix) }],
      exports: [MatchingQueue],
    };
  }

  // A wrong policy refuses to boot. Redis down at boot doesn't: /health reports that, and the check gives up
  // after 1 s. shortcut: a Redis that is down at boot and evicts when it's back goes unnoticed (BullMQ only warns)
  async onModuleInit(): Promise<void> {
    const checked = await Promise.race([
      assertNoEviction(this.redis).then(() => true),
      new Promise<false>((resolve) => setTimeout(resolve, 1000, false).unref()),
    ]);
    if (!checked) new Logger(QueueModule.name).warn('Redis unreachable at boot: maxmemory-policy not checked');
  }

  // Before RedisModule and TypeORM close (onApplicationShutdown)
  onModuleDestroy(): Promise<void> {
    return this.queue.close();
  }
}
