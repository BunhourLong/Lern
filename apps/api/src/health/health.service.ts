import type { Health } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';

type Status = Health['db'];

// A probe must answer fast; a hung dependency counts as down
const TIMEOUT_MS = 1000;

async function probe(check: () => Promise<unknown>): Promise<Status> {
  try {
    await Promise.race([check(), new Promise((_, reject) => setTimeout(reject, TIMEOUT_MS).unref())]);
    return 'up';
  } catch {
    return 'down';
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly db: DataSource,
    private readonly redis: Redis,
  ) {}

  async check(): Promise<Health> {
    const [db, redis] = await Promise.all([probe(() => this.db.query('SELECT 1')), probe(() => this.redis.ping())]);
    return { status: db === 'up' && redis === 'up' ? 'ok' : 'error', db, redis };
  }
}
