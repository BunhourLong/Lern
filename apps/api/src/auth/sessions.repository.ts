import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

// Postgres UPDATE through TypeORM's query() resolves to [rows, rowCount]
type Updated<T> = [T[], number];

// Every method takes the caller's transaction: SessionsService owns the boundaries
@Injectable()
export class SessionsRepository {
  async insert(tx: EntityManager, userId: string, familyId: string, tokenHash: string, ttlSeconds: number): Promise<void> {
    await tx.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 second')`,
      [userId, familyId, tokenHash, ttlSeconds],
    );
  }

  // Guarded: only a live, unexpired token is claimed, so a token rotates exactly once even under races
  async claim(tx: EntityManager, tokenHash: string): Promise<{ userId: string; familyId: string } | undefined> {
    const [rows] = await tx.query<Updated<{ userId: string; familyId: string }>>(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id AS "userId", family_id AS "familyId"`,
      [tokenHash],
    );
    return rows[0];
  }

  // Presenting an already-revoked token means it was copied: kill every live token in its family
  async revokeFamilyIfReused(tx: EntityManager, tokenHash: string): Promise<void> {
    await tx.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL
         AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NOT NULL)`,
      [tokenHash],
    );
  }
}
