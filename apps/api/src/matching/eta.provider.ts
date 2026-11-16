import type { Point } from '@lern/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { rankByEta } from './domain/rank-by-eta';
import { MATCHING_CONFIG, type MatchingConfig } from './matching.config';

// A sync waits for this holding its ride's lock; local OSRM answers a 5×1 table in milliseconds
const TIMEOUT_MS = 1000;

const tableOf = (rows: number) =>
  z.object({ code: z.literal('Ok'), durations: z.array(z.tuple([z.number().nonnegative().nullable()])).length(rows) });

// Road ETAs from OSRM's table service (PLAN.md §2.4)
@Injectable()
export class EtaProvider {
  private readonly logger = new Logger(EtaProvider.name);

  constructor(@Inject(MATCHING_CONFIG) private readonly config: MatchingConfig) {}

  // Candidates (nearest first) by road ETA to the pickup, in one request; any failure keeps straight-line order
  async rank<C extends Point & { distanceM: number }>(pickup: Point, candidates: C[]): Promise<(C & { etaS: number })[]> {
    if (candidates.length === 0) return [];
    const coords = [...candidates, pickup].map((p) => `${p.lng},${p.lat}`).join(';');
    const sources = candidates.map((_, i) => i).join(';');
    let durations: (number | null)[] | undefined;
    try {
      const res = await fetch(
        `${this.config.OSRM_URL}/table/v1/driving/${coords}?sources=${sources}&destinations=${candidates.length}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      const table = tableOf(candidates.length).safeParse(await res.json());
      if (table.success) durations = table.data.durations.map(([s]) => s);
      else this.logger.warn(`OSRM table unusable (HTTP ${res.status}), ranking by straight line`);
    } catch (err) {
      this.logger.warn(`OSRM table failed (${(err as Error).name}), ranking by straight line`);
    }
    return rankByEta(candidates, durations);
  }
}
