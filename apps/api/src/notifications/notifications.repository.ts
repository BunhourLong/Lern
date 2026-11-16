import type { PushLocale, RegisterDevice } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

// One phone may sign in to several accounts over time, and one account may have several phones
const MAX_TOKENS_PER_USER = 5;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: DataSource) {}

  // The token is the phone: signing in on it takes it over, so the previous user's pushes stop reaching this phone.
  // The DELETE sees the table as it was before this statement, hence the `<> $1` and the limit minus one. Its own
  // `user_id` check is re-read after a lock wait, so a token another user took over meanwhile is not trimmed.
  async register(userId: string, { token, platform, locale }: RegisterDevice): Promise<void> {
    await this.db.query(
      `WITH upserted AS (
         INSERT INTO device_tokens (token, user_id, platform, locale) VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, locale = EXCLUDED.locale, updated_at = now()
       )
       DELETE FROM device_tokens WHERE user_id = $2 AND token IN (
         SELECT token FROM device_tokens WHERE user_id = $2 AND token <> $1 ORDER BY updated_at DESC OFFSET $5
       )`,
      [token, userId, platform, locale, MAX_TOKENS_PER_USER - 1],
    );
  }

  // nowMs is the database's clock, so every instance agrees on what has expired
  async targets(userIds: string[]): Promise<{ groups: { locale: PushLocale; tokens: string[] }[]; nowMs: number }> {
    const [row] = await this.db.query<{ groups: { locale: PushLocale; tokens: string[] }[]; nowMs: number }[]>(
      `SELECT COALESCE(
                (SELECT json_agg(json_build_object('locale', locale, 'tokens', tokens) ORDER BY locale)
                 FROM (SELECT locale, array_agg(token) AS tokens FROM device_tokens WHERE user_id = ANY($1::uuid[]) GROUP BY locale) g),
                '[]'::json) AS groups,
              (extract(epoch FROM now()) * 1000)::float8 AS "nowMs"`,
      [userIds],
    );
    return row;
  }

  async remove(tokens: string[]): Promise<void> {
    await this.db.query('DELETE FROM device_tokens WHERE token = ANY($1::text[])', [tokens]);
  }
}
