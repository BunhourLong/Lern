import type { Me, Role } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DataSource) {}

  // DO UPDATE (not DO NOTHING) so RETURNING yields the id for an existing phone too; safe under concurrent signups.
  // xmax = 0 only for a freshly inserted row, so the rider role is granted at signup and never re-granted.
  async upsertByPhone(phone: string): Promise<string> {
    const [row] = await this.db.query<{ id: string }[]>(
      `WITH u AS (
         INSERT INTO users (phone) VALUES ($1)
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING id, xmax = 0 AS created
       ), granted AS (
         INSERT INTO user_roles (user_id, role) SELECT id, 'rider' FROM u WHERE created
       )
       SELECT id FROM u`,
      [phone],
    );
    return row.id;
  }

  async grantRole(tx: EntityManager, userId: string, role: Role): Promise<void> {
    await tx.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, role]);
  }

  async roles(userId: string): Promise<Role[]> {
    const rows = await this.db.query<{ role: Role }[]>(
      'SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role',
      [userId],
    );
    return rows.map((r) => r.role);
  }

  async findMe(userId: string): Promise<Me | undefined> {
    const [row] = await this.db.query<Me[]>(
      `SELECT u.id, u.phone, coalesce(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId],
    );
    return row;
  }
}
