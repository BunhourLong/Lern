import { Client } from '@duosecurity/duo_universal';
import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Config } from '../shared/config/env';
import { DevStaffMfaProvider } from './dev-staff-mfa.provider';
import { deriveMfaStateKey } from './domain/mfa-state';
import { DUO_CLIENT, DuoStaffMfaProvider } from './duo-staff-mfa.provider';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthRepository } from './staff-auth.repository';
import { ADMIN_COOKIE_SECURE, MFA_STATE_KEY, StaffAuthService } from './staff-auth.service';
import { StaffMfaProvider } from './staff-mfa.provider';

// parseEnv guarantees a provider (and Duo's keys) when admin is on; checked again for configs built some other way
function mfaProviders(config: Config): Provider[] {
  if (config.STAFF_MFA_PROVIDER === 'dev') return [{ provide: StaffMfaProvider, useClass: DevStaffMfaProvider }];
  const { DUO_CLIENT_ID: clientId, DUO_CLIENT_SECRET: clientSecret, DUO_API_HOST: apiHost, DUO_REDIRECT_URL: redirectUrl } = config;
  if (config.STAFF_MFA_PROVIDER !== 'duo' || !clientId || !clientSecret || !apiHost || !redirectUrl) {
    throw new Error('AdminModule needs STAFF_MFA_PROVIDER, and DUO_* with duo');
  }
  return [
    { provide: DUO_CLIENT, useValue: new Client({ clientId, clientSecret, apiHost, redirectUrl }) },
    { provide: StaffMfaProvider, useFactory: (client: Client) => new DuoStaffMfaProvider(client), inject: [DUO_CLIENT] },
  ];
}

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
        ...mfaProviders(config),
        { provide: MFA_STATE_KEY, useValue: deriveMfaStateKey(config.JWT_SECRET) },
        { provide: ADMIN_COOKIE_SECURE, useValue: config.ADMIN_COOKIE_SECURE },
        { provide: APP_GUARD, useClass: StaffAuthGuard },
      ],
    };
  }
}
