import type { AppConfig } from '@lern/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { Public } from '../auth/auth.decorators';
import { APP_CONFIG } from './app-config.config';
import { AppConfigDto } from './dto/app-config.dto';

// Read by the mobile app at boot; experience only, so no token and nothing to gate
@Public()
@Controller('app-config')
export class AppConfigController {
  constructor(@Inject(APP_CONFIG) private readonly appConfig: AppConfig) {}

  @Get()
  @ZodSerializerDto(AppConfigDto)
  show(): AppConfig {
    return this.appConfig;
  }
}
