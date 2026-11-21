import type { StaffSummary } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { StaffSessionContext } from './admin.decorators';

// Postgres UPDATE through TypeORM's query() resolves to [rows, rowCount]
type Updated<T> = [T[], number];

export type StaffAccount = StaffSummary & { status: 'active' | 'disabled'; passwordHash: string; isLocked: boolean };

const MAX_FAILED = 5;

// Every deadline (lockout, 8 h session, 30 min idle) is the database's now(): one clock for every API instance
@Injectable()
export class StaffAuthRepository {
  constructor(private readonly db: DataSource) {}

  async findAccountByEmail(email: string): Promise<StaffAccount | undefined> {
    const rows = await this.db.query<StaffAccount[]>(
      `SELECT u.id, u.email, u.display_name AS "displayName", u.is_super_admin AS "isSuperAdmin", u.status,
              c.password_hash AS "passwordHash", (c.locked_until IS NOT NULL AND c.locked_until > now()) AS "isLocked"
       FROM staff_users u JOIN staff_credentials c ON c.staff_user_id = u.id
       WHERE lower(u.email) = $1`,
      [email],
    );
    return rows[0];
  }

  // One atomic statement, so parallel wrong passwords can't skip the lock. A lapsed lock starts a fresh count; a live
  // lock is left alone, so a wrong password still in flight never extends it.
  async recordFailedLogin(staffUserId: string): Promise<void> {
    await this.db.query(
      `UPDATE staff_credentials SET
         failed_attempts = CASE WHEN locked_until <= now() THEN 1 ELSE failed_attempts + 1 END,
         locked_until = CASE WHEN locked_until <= now() THEN NULL
                             WHEN failed_attempts + 1 >= $2 THEN now() + interval '15 minutes'
                             ELSE locked_until END,
         updated_at = now()
       WHERE staff_user_id = $1 AND (locked_until IS NULL OR locked_until <= now())`,
      [staffUserId, MAX_FAILED],
    );
  }

  // True while the account may still sign in: re-read after the slow steps (scrypt, MFA), before acting on them
  async isEligible(staffUserId: string): Promise<boolean> {
    const rows = await this.db.query<unknown[]>(
      `SELECT 1 FROM staff_users u JOIN staff_credentials c ON c.staff_user_id = u.id
       WHERE u.id = $1 AND u.status = 'active' AND (c.locked_until IS NULL OR c.locked_until <= now())`,
      [staffUserId],
    );
    return rows.length > 0;
  }

  // Null means refuse. FOR SHARE conflicts with a disable's row lock: an uncommitted disable makes this wait, and once
  // it commits the row is re-checked and no longer matches. A plain EXISTS (and the FK check's FOR KEY SHARE) would
  // not wait. The reset is guarded on unlocked (re-checked on the latest row if a failure locked it during scrypt or
  // MFA), and the session exists only if the reset happened.
  async createSessionIfEligible(params: {
    staffUserId: string;
    tokenHash: string;
    csrfToken: string;
    ip: string | undefined;
    userAgent: string | undefined;
  }): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const active = await tx.query<unknown[]>(`SELECT 1 FROM staff_users WHERE id = $1 AND status = 'active' FOR SHARE`, [
        params.staffUserId,
      ]);
      if (!active.length) return null;
      const [reset] = await tx.query<Updated<unknown>>(
        `UPDATE staff_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE staff_user_id = $1 AND (locked_until IS NULL OR locked_until <= now())
         RETURNING staff_user_id`,
        [params.staffUserId],
      );
      if (!reset.length) return null;
      const rows = await tx.query<{ id: string }[]>(
        `INSERT INTO staff_sessions (staff_user_id, token_hash, csrf_token, expires_at, created_ip, user_agent)
         VALUES ($1, $2, $3, now() + interval '8 hours', $4, $5)
         RETURNING id`,
        [params.staffUserId, params.tokenHash, params.csrfToken, params.ip ?? null, params.userAgent ?? null],
      );
      return rows[0].id;
    });
  }

  // Guarded and sliding in one statement: a revoked, expired, idle (30 min) or disabled session reads nothing and
  // is not touched
  async validateAndSlideSession(tokenHash: string): Promise<StaffSessionContext | undefined> {
    const [rows] = await this.db.query<
      Updated<{ sessionId: string; csrfToken: string } & StaffSummary>
    >(
      `UPDATE staff_sessions s SET last_seen_at = now()
       FROM staff_users u
       WHERE s.staff_user_id = u.id AND s.token_hash = $1
         AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
         AND u.status = 'active'
       RETURNING s.id AS "sessionId", s.csrf_token AS "csrfToken",
                 u.id, u.email, u.display_name AS "displayName", u.is_super_admin AS "isSuperAdmin"`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return undefined;
    const { sessionId, csrfToken, ...staff } = row;
    return { sessionId, csrfToken, staff };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query(`UPDATE staff_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
  }

  async revokeAllSessions(staffUserId: string): Promise<void> {
    await this.db.query(`UPDATE staff_sessions SET revoked_at = now() WHERE staff_user_id = $1 AND revoked_at IS NULL`, [
      staffUserId,
    ]);
  }
}
