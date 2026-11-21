import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Config } from '../shared/config/env';
import { DevStaffMfaProvider } from './dev-staff-mfa.provider';
import { ADMIN_COOKIE_SECURE, StaffAuthController } from './staff-auth.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthRepository } from './staff-auth.repository';
import { StaffAuthService } from './staff-auth.service';
import { StaffMfaProvider } from './staff-mfa.provider';

// Staff web admin (PLAN.md M7). AppModule imports it only when ADMIN_ENABLED; refusing here too keeps it that way.
@Module({})
export class AdminModule {
  static forRoot(config: Config): DynamicModule {
    if (!config.ADMIN_ENABLED) throw new Error('AdminModule needs ADMIN_ENABLED=true');
    return {
      module: AdminModule,
      controllers: [StaffAuthController],
      providers: [
        StaffAuthRepository,
        StaffAuthService,
        // parseEnv guarantees a provider when admin is on; dev is the only one so far
        { provide: StaffMfaProvider, useClass: DevStaffMfaProvider },
        { provide: ADMIN_COOKIE_SECURE, useValue: config.ADMIN_COOKIE_SECURE },
        { provide: APP_GUARD, useClass: StaffAuthGuard },
      ],
    };
  }
}
