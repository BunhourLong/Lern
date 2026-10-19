import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';

// A probe must answer fast; a hung dependency counts as down
const TIMEOUT_MS = 1000;

async function up(check: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(reject, TIMEOUT_MS).unref()),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DataSource,
    private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [db, redis] = await Promise.all([up(() => this.db.query('SELECT 1')), up(() => this.redis.ping())]);
    const body = { status: db === 'up' && redis === 'up' ? 'ok' : 'error', db, redis };
    if (body.status === 'error') throw new ServiceUnavailableException(body);
    return body;
  }
}
