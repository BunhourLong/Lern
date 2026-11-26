import type { Client } from '@duosecurity/duo_universal';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { StaffMfaProvider } from './staff-mfa.provider';

export const DUO_CLIENT = 'admin:duo-client';
// The SDK's HTTP client has no timeout of its own
export const DUO_TIMEOUT_MS = 10_000;

class DuoTimeout extends Error {
  override name = 'DuoTimeout';
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {}); // a late failure after the timeout must not become an unhandled rejection
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new DuoTimeout()), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

// The SDK wraps every failure in a DuoException; an HTTP one keeps the Axios error as `inner`
type Failure = Error & { inner?: { isAxiosError?: boolean; code?: string; response?: { status?: number } } };

// Duo unreachable (timeout, network, DNS, TLS, 5xx) is an outage: 503, try again. Anything else (4xx, a bad token,
// another user) is a refused login.
const isOutage = (err: Failure) =>
  err instanceof DuoTimeout || (err.inner?.isAxiosError === true && (err.inner.response?.status ?? 500) >= 500);

// Duo Universal Prompt (PLAN.md M7). Every failure is logged by kind only: the code, the state and the client secret
// (inside the Axios config) never reach a log.
export class DuoStaffMfaProvider extends StaffMfaProvider {
  private readonly logger = new Logger(DuoStaffMfaProvider.name);

  constructor(
    private readonly client: Client,
    private readonly timeoutMs = DUO_TIMEOUT_MS,
  ) {
    super();
  }

  async begin(staff: { id: string; email: string }, state: string): Promise<{ status: 'redirect'; redirectUrl: string }> {
    try {
      // Duo's own advice: don't send a browser to a prompt that is down
      const health = await withTimeout(this.client.healthCheck(), this.timeoutMs);
      if (health?.stat !== 'OK') throw new Error('Duo health check not OK');
      return { status: 'redirect', redirectUrl: await this.client.createAuthUrl(staff.email, state) };
    } catch (err) {
      this.warn('begin', err as Failure);
      throw new ServiceUnavailableException('Second factor unavailable');
    }
  }

  async complete(code: string, expectedEmail: string): Promise<boolean> {
    let result: Awaited<ReturnType<Client['exchangeAuthorizationCodeFor2FAResult']>>;
    try {
      result = await withTimeout(this.client.exchangeAuthorizationCodeFor2FAResult(code, expectedEmail), this.timeoutMs);
    } catch (err) {
      this.warn('complete', err as Failure);
      if (isOutage(err as Failure)) throw new ServiceUnavailableException('Second factor unavailable');
      return false;
    }
    // The SDK checks the username too; checked again here so the decision is all in one place
    return (
      result?.preferred_username === expectedEmail &&
      result.auth_result?.result === 'allow' &&
      result.auth_result?.status === 'allow'
    );
  }

  private warn(step: string, err: Failure): void {
    this.logger.warn(`Duo ${step} failed: ${err.name} ${err.inner?.code ?? ''} ${err.inner?.response?.status ?? ''}`.trimEnd());
  }
}
