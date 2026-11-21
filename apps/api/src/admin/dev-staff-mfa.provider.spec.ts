import type { Config } from '../shared/config/env';
import { AdminModule } from './admin.module';
import { DevStaffMfaProvider } from './dev-staff-mfa.provider';

it('refuses to exist in production', () => {
  const env = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    expect(() => new DevStaffMfaProvider()).toThrow(/production/);
    process.env.NODE_ENV = 'development';
    expect(() => new DevStaffMfaProvider()).not.toThrow();
  } finally {
    process.env.NODE_ENV = env;
  }
});

it('AdminModule refuses to mount with ADMIN_ENABLED=false', () => {
  expect(() => AdminModule.forRoot({ ADMIN_ENABLED: false } as Config)).toThrow(/ADMIN_ENABLED/);
});
