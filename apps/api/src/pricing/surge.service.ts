import type { Point, VehicleType } from '@lern/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import { smoothBp, type SurgeRule, targetBp } from './domain/surge';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';
import { PricingRepository } from './pricing.repository';

const ONE_X = 10_000;
const RESOLUTION = 8;
// An I/O bound on one HGET, not a business timer
const READ_TIMEOUT_MS = 200;
const VEHICLE_TYPES: readonly VehicleType[] = ['moto', 'remork', 'bajaj'];

@Injectable()
export class SurgeService {
  private readonly logger = new Logger(SurgeService.name);

  constructor(
    @Inject(PRICING_CONFIG) private readonly config: PricingConfig,
    private readonly pricing: PricingRepository,
    private readonly redis: Redis,
  ) {}

  // The quote's multiplier: the cached value at the pickup's cell, clamped to the cap. Anything unusable is 1.0x,
  // and so is a Redis that fails or is slow: a Redis outage must never become a quote outage.
  async surgeBp(vehicleType: VehicleType, pickup: Point): Promise<number> {
    const key = `${this.config.QUEUE_PREFIX}:surge:${vehicleType}`;
    // shortcut: a Redis that keeps the socket open but never answers keeps each timed-out HGET queued in the shared
    // client until it answers or the socket closes (as for every other Redis caller); give surge reads their own
    // client with commandTimeout if a stalled Redis ever shows up in production.
    const read = this.redis.hget(key, latLngToCell(pickup.lat, pickup.lng, RESOLUTION));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${READ_TIMEOUT_MS} ms`)), READ_TIMEOUT_MS);
    });
    try {
      // race subscribes to read, so a read that loses still has a handler when it rejects later (on disconnect)
      const value = await Promise.race([read, timeout]);
      if (value === null) return ONE_X;
      const bp = Number(value);
      // Round trip: Number() would accept '1.5e4' or round '15000.0000000000001' to an integer
      if (Number.isSafeInteger(bp) && String(bp) === value && bp >= ONE_X) return Math.min(bp, this.config.SURGE_CAP_BP);
      this.logger.warn(`Ignoring surge ${JSON.stringify(value)} in ${key}: priced at 1.0x`);
    } catch (err) {
      this.logger.warn(`Surge read failed (${(err as Error).message}): priced at 1.0x`);
    } finally {
      clearTimeout(timer);
    }
    return ONE_X;
  }

  // Every cell with demand or a stored value is recomputed; one at 1.0x drops out of its type's hash.
  // shortcut: a job stalled long enough for BullMQ to rerun it within one interval steps surge twice; key the run
  // on a Redis timestamp if that ever shows up in production.
  async run(): Promise<void> {
    const rule: SurgeRule = {
      slopeBp: this.config.SURGE_SLOPE_BP,
      capBp: this.config.SURGE_CAP_BP,
      maxStepBp: this.config.SURGE_MAX_STEP_BP,
    };
    const samples = await this.pricing.surgeSamples();
    for (const vehicleType of VEHICLE_TYPES) {
      const key = `${this.config.QUEUE_PREFIX}:surge:${vehicleType}`;
      const stored = await this.redis.hgetall(key);
      const demand = new Map<string, number>();
      const supply = new Map<string, number>();
      for (const sample of samples) {
        if (sample.vehicleType !== vehicleType) continue;
        const cell = latLngToCell(sample.lat, sample.lng, RESOLUTION);
        const counts = sample.kind === 'demand' ? demand : supply;
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
      const next = new Map<string, number>();
      for (const cell of new Set([...demand.keys(), ...Object.keys(stored)])) {
        const prev = stored[cell] === undefined ? ONE_X : Number(stored[cell]);
        const value = smoothBp(rule, prev, targetBp(rule, { demand: demand.get(cell) ?? 0, supply: supply.get(cell) ?? 0 }));
        if (value > ONE_X) next.set(cell, value);
      }
      // One transaction per hash: readers never see a half-replaced map, and a stopped job lapses to 1.0x
      const tx = this.redis.multi().del(key);
      if (next.size > 0) {
        tx.hset(key, Object.fromEntries([...next].map(([cell, value]) => [cell, String(value)])));
        tx.pexpire(key, 3 * this.config.SURGE_INTERVAL_MS);
      }
      const results = await tx.exec();
      if (!results) throw new Error('surge update was aborted');
    }
  }
}
