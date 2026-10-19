import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DataSource) {}

  // DO UPDATE (not DO NOTHING) so RETURNING yields the id for an existing phone too; safe under concurrent signups
  async upsertByPhone(phone: string): Promise<string> {
    const [row] = await this.db.query<{ id: string }[]>(
      `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
      [phone],
    );
    return row.id;
  }
}
