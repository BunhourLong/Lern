import type { StaffLogin, StaffMfaCallback, StaffSummary } from '@lern/contracts';
import { HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { consume } from '../shared/redis/rate-limit';
import { parseStaffMfaCookie, STAFF_MFA_COOKIE_MAX_AGE_S } from './domain/cookie';
import { signMfaState, verifyMfaState } from './domain/mfa-state';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './domain/password';
import { StaffAuthRepository } from './staff-auth.repository';
import { StaffMfaProvider } from './staff-mfa.provider';

const WINDOW_S = 15 * 60;

export const MFA_STATE_KEY = 'admin:mfa-state-key';
export const ADMIN_COOKIE_SECURE = 'admin:cookie-secure';

export type StaffLoginResult =
  | { status: 'authenticated'; staff: StaffSummary; csrfToken: string; rawToken: string }
  | { status: 'mfa_required'; redirectUrl: string; mfaBindingToken: string };

export const hashSessionToken = (rawToken: string) => createHash('sha256').update(rawToken).digest('hex');

// One answer for every refusal, so it never tells an attacker which emails exist or which accounts are locked
const invalid = () => new UnauthorizedException('Invalid credentials');

const nowSec = () => Math.floor(Date.now() / 1000);
const pendingKey = (pendingId: string) => `mfa:pending:${pendingId}`;

// A pending Duo login is redeemed once, and only with the state it was issued with from the browser it was issued
// to: a mismatch leaves it alone (another browser can't burn it), a match deletes it in the same step.
const CONSUME_PENDING = `
local v = redis.call('HMGET', KEYS[1], 'staffUserId', 'email', 'passwordUpdatedAt', 'stateHash', 'bindingHash')
if not v[1] or v[4] ~= ARGV[1] or v[5] ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return { v[1], v[2], v[3] }`;

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly repo: StaffAuthRepository,
    private readonly mfa: StaffMfaProvider,
    private readonly redis: Redis,
    @Inject(MFA_STATE_KEY) private readonly mfaStateKey: Buffer,
    @Inject(ADMIN_COOKIE_SECURE) private readonly secure: boolean,
  ) {}

  async login({ email, password }: StaffLogin, ip: string | undefined, userAgent: string | undefined): Promise<StaffLoginResult> {
    // Before the database and scrypt, so a flood costs neither. Each window is checked only after the previous passed.
    await this.limit(`rl:admin:login:ip:${ip}`, 20);
    await this.limit(`rl:admin:login:email:${email}`, 10);

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
    if (!(await this.repo.isEligible(account.id, account.passwordUpdatedAt))) throw invalid();

    const pendingId = randomBytes(16).toString('base64url');
    const state = signMfaState({ pendingId, staffUserId: account.id, expSec: nowSec() + STAFF_MFA_COOKIE_MAX_AGE_S }, this.mfaStateKey);
    // A provider error propagates: no session, no cookie
    const step = await this.mfa.begin({ id: account.id, email: account.email }, state);
    if (step.status === 'redirect') {
      if (!(await this.repo.isEligible(account.id, account.passwordUpdatedAt))) throw invalid();
      // Nothing is granted yet: the lock count and the email window stay until the callback signs in
      const mfaBindingToken = randomBytes(32).toString('base64url');
      const key = pendingKey(pendingId);
      const results = await this.redis
        .multi()
        .hset(key, {
          staffUserId: account.id,
          email: account.email,
          passwordUpdatedAt: account.passwordUpdatedAt,
          stateHash: hashSessionToken(state),
          bindingHash: hashSessionToken(mfaBindingToken),
        })
        .expire(key, STAFF_MFA_COOKIE_MAX_AGE_S)
        .exec();
      if (!results || results.some(([err]) => err)) throw new Error('Could not store the pending MFA login');
      return { status: 'mfa_required', redirectUrl: step.redirectUrl, mfaBindingToken };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const created = await this.repo.createSessionIfEligible({
      staffUserId: account.id,
      expectedEmail: account.email,
      expectedPasswordUpdatedAt: account.passwordUpdatedAt,
      tokenHash: hashSessionToken(rawToken),
      csrfToken,
      ip,
      userAgent,
    });
    if (!created) throw invalid(); // locked or disabled while scrypt or MFA ran
    await this.clearEmailLimit(email);
    return { status: 'authenticated', staff: created.staff, csrfToken, rawToken };
  }

  // The browser's return from Duo. Every check that needs neither Redis nor Duo runs first; onConsumed tells the
  // caller the pending login is gone, so its binding cookie can be cleared whatever happens next.
  async completeMfa(
    { state, code }: StaffMfaCallback,
    cookieHeader: string | undefined,
    ip: string | undefined,
    userAgent: string | undefined,
    onConsumed?: () => void,
  ): Promise<{ staff: StaffSummary; csrfToken: string; rawToken: string }> {
    await this.limit(`rl:admin:mfa:ip:${ip}`, 20);
    const claims = verifyMfaState(state, this.mfaStateKey, nowSec());
    if (!claims) throw invalid();
    const bindingToken = parseStaffMfaCookie(cookieHeader, this.secure);
    if (!bindingToken) throw invalid();

    const pending = (await this.redis.eval(
      CONSUME_PENDING,
      1,
      pendingKey(claims.pendingId),
      hashSessionToken(state),
      hashSessionToken(bindingToken),
    )) as [staffUserId: string, email: string, passwordUpdatedAt: string] | null;
    if (!pending) throw invalid();
    onConsumed?.();
    const [staffUserId, email, passwordUpdatedAt] = pending;
    if (claims.staffUserId !== staffUserId) throw invalid();

    // An outage (503) propagates
    if (!(await this.mfa.complete(code, email))) throw invalid();

    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const created = await this.repo.createSessionIfEligible({
      staffUserId,
      expectedEmail: email,
      expectedPasswordUpdatedAt: passwordUpdatedAt,
      tokenHash: hashSessionToken(rawToken),
      csrfToken,
      ip,
      userAgent,
    });
    if (!created) throw invalid(); // disabled, locked, renamed or given a new password while Duo ran
    await this.clearEmailLimit(email);
    return { staff: created.staff, csrfToken, rawToken };
  }

  logout(sessionId: string): Promise<void> {
    return this.repo.revokeSession(sessionId);
  }

  logoutAll(staffUserId: string): Promise<void> {
    return this.repo.revokeAllSessions(staffUserId);
  }

  // The session already exists: a Redis hiccup here must not turn a sign-in into an error. The window lapses anyway.
  private async clearEmailLimit(email: string): Promise<void> {
    try {
      await this.redis.del(`rl:admin:login:email:${email}`);
    } catch (err) {
      this.logger.warn(`Failed to clear login limit: ${(err as Error).name}`);
    }
  }

  private async limit(key: string, limit: number): Promise<void> {
    const retryAfter = await consume(this.redis, key, limit, WINDOW_S);
    if (retryAfter) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many login attempts', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
