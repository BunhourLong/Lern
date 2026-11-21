import type { StaffLogin, StaffSummary } from '@lern/contracts';
import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { consume } from '../shared/redis/rate-limit';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './domain/password';
import { StaffAuthRepository } from './staff-auth.repository';
import { StaffMfaProvider } from './staff-mfa.provider';

const WINDOW_S = 15 * 60;

export type StaffLoginResult =
  | { status: 'authenticated'; staff: StaffSummary; csrfToken: string; rawToken: string }
  | { status: 'mfa_required'; redirectUrl: string };

export const hashSessionToken = (rawToken: string) => createHash('sha256').update(rawToken).digest('hex');

// One answer for every refusal, so it never tells an attacker which emails exist or which accounts are locked
const invalid = () => new UnauthorizedException('Invalid credentials');

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly repo: StaffAuthRepository,
    private readonly mfa: StaffMfaProvider,
    private readonly redis: Redis,
  ) {}

  async login({ email, password }: StaffLogin, ip: string | undefined, userAgent: string | undefined): Promise<StaffLoginResult> {
    // Before the database and scrypt, so a flood costs neither. Each window is checked only after the previous passed.
    const limits: [key: string, limit: number][] = [
      [`rl:admin:login:ip:${ip}`, 20],
      [`rl:admin:login:email:${email}`, 10],
    ];
    for (const [key, limit] of limits) {
      const retryAfter = await consume(this.redis, key, limit, WINDOW_S);
      if (retryAfter) {
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many login attempts', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const account = await this.repo.findAccountByEmail(email);
    if (!account || account.status !== 'active' || account.isLocked) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH); // same scrypt work as a real check: timing tells nothing
      throw invalid();
    }
    if (!(await verifyPassword(password, account.passwordHash))) {
      await this.repo.recordFailedLogin(account.id);
      throw invalid();
    }
    // Locked or disabled while scrypt ran: no MFA push to the owner's phone
    if (!(await this.repo.isEligible(account.id))) throw invalid();

    // A provider error propagates: no session, no cookie
    const step = await this.mfa.begin({ id: account.id, email: account.email });
    if (step.status === 'redirect') {
      if (!(await this.repo.isEligible(account.id))) throw invalid();
      return { status: 'mfa_required', redirectUrl: step.redirectUrl };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const sessionId = await this.repo.createSessionIfEligible({
      staffUserId: account.id,
      tokenHash: hashSessionToken(rawToken),
      csrfToken,
      ip,
      userAgent,
    });
    if (!sessionId) throw invalid(); // locked or disabled while scrypt or MFA ran
    await this.redis.del(`rl:admin:login:email:${email}`);
    const { id, displayName, isSuperAdmin } = account;
    return { status: 'authenticated', staff: { id, email: account.email, displayName, isSuperAdmin }, csrfToken, rawToken };
  }

  logout(sessionId: string): Promise<void> {
    return this.repo.revokeSession(sessionId);
  }

  logoutAll(staffUserId: string): Promise<void> {
    return this.repo.revokeAllSessions(staffUserId);
  }
}
