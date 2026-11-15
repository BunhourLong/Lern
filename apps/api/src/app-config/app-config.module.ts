import { DynamicModule, Module } from '@nestjs/common';
import type { Config } from '../shared/config/env';
import { AppConfigController } from './app-config.controller';
import { APP_CONFIG, toAppConfig } from './app-config.config';

@Module({})
export class AppConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppConfigModule,
      controllers: [AppConfigController],
      providers: [{ provide: APP_CONFIG, useValue: toAppConfig(config) }],
    };
  }
}
