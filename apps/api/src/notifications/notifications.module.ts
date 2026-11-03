import { DynamicModule, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Config } from '../shared/config/env';
import { DevPushProvider } from './dev-push.provider';
import { fcmMessaging, FcmPushProvider } from './fcm-push.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { PushProvider } from './push.provider';
import { PushQueue } from './push-queue';

@Module({})
export class NotificationsModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: NotificationsModule,
      // Global, like QueueModule: the outbox hands it events
      global: true,
      controllers: [NotificationsController],
      providers: [
        NotificationsRepository,
        NotificationsService,
        { provide: PushQueue, inject: [Redis], useFactory: (redis: Redis) => new PushQueue(redis, config.QUEUE_PREFIX) },
        {
          provide: PushProvider,
          // parseEnv guarantees the path when PUSH_PROVIDER is fcm
          useFactory: () =>
            config.PUSH_PROVIDER === 'fcm' ? new FcmPushProvider(fcmMessaging(config.FIREBASE_SERVICE_ACCOUNT_PATH!)) : new DevPushProvider(),
        },
      ],
      exports: [NotificationsService],
    };
  }
}
