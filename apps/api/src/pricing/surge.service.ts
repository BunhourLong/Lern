import type { VehicleType } from '@lern/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import { smoothBp, type SurgeRule, targetBp } from './domain/surge';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';
import { PricingRepository } from './pricing.repository';

const ONE_X = 10_000;
const RESOLUTION = 8;
const VEHICLE_TYPES: readonly VehicleType[] = ['moto', 'remork', 'bajaj'];

@Injectable()
export class SurgeService {
  constructor(
    @Inject(PRICING_CONFIG) private readonly config: PricingConfig,
    private readonly pricing: PricingRepository,
    private readonly redis: Redis,
  ) {}

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
