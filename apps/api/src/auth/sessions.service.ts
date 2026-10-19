import type { TokenPair } from '@lern/contracts';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { AccessTokenService } from './access-token.service';
import { OtpService } from './otp.service';
import { SessionsRepository } from './sessions.repository';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

// Refresh tokens are 256-bit random, so a plain SHA-256 is enough to make a DB leak useless
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// A session is one refresh-token family: one login on one device, rotated on every refresh
@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DataSource,
    private readonly tokens: AccessTokenService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly sessions: SessionsRepository,
  ) {}

  async start(phone: string, code: string): Promise<TokenPair> {
    if (!(await this.otp.verify(phone, code))) throw new UnauthorizedException('Invalid code');
    const userId = await this.users.findOrCreateByPhone(phone);
    return this.db.transaction((tx) => this.issue(tx, userId, randomUUID()));
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = hash(refreshToken);
    // Returns null rather than throwing, so the family revocation commits
    const pair = await this.db.transaction(async (tx) => {
      const claimed = await this.sessions.claim(tx, tokenHash);
      if (claimed) return this.issue(tx, claimed.userId, claimed.familyId);
      await this.sessions.revokeFamilyIfReused(tx, tokenHash);
      return null;
    });
    if (!pair) throw new UnauthorizedException('Invalid refresh token');
    return pair;
  }

  private async issue(tx: EntityManager, userId: string, familyId: string): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.sessions.insert(tx, userId, familyId, hash(refreshToken), REFRESH_TTL_SECONDS);
    // Roles are re-read on every refresh, so a role change reaches the token within its 15-minute life
    const accessToken = await this.tokens.sign({ id: userId, roles: await this.users.roles(userId) });
    return { accessToken, refreshToken };
  }
}
