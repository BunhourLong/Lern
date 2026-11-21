import { StaffMfaProvider } from './staff-mfa.provider';

// Local development only: approves every login without a second factor. parseEnv refuses it in production; the
// constructor refuses it again in case a deploy sets NODE_ENV some other way.
export class DevStaffMfaProvider extends StaffMfaProvider {
  constructor() {
    super();
    if (process.env.NODE_ENV === 'production') throw new Error('DevStaffMfaProvider must not run in production');
  }

  begin(): Promise<{ status: 'approved' }> {
    return Promise.resolve({ status: 'approved' });
  }

  complete(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
