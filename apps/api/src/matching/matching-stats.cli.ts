// `pnpm --filter @lern/api stats --since 1h` (no `--`: pnpm passes it on): the matching report (PLAN.md M4) over the rides booked in a window,
// read from the database, so it holds across instances and restarts (e.g. after a simulator or load-test run)
import { parseArgs } from 'node:util';
import { parseEnv } from '../shared/config/env';
import { createDataSource } from '../shared/database/database';
import { MatchingRepository, type MatchingStats } from './matching.repository';

const UNIT_S = { s: 1, m: 60, h: 3600, d: 86_400 };

function seconds(window: string): number {
  const m = /^(\d+)([smhd])$/.exec(window);
  if (!m) throw new Error(`--since takes a number and a unit (s, m, h, d), e.g. 1h; got "${window}"`);
  return Number(m[1]) * UNIT_S[m[2] as keyof typeof UNIT_S];
}

const pct = (n: number, of: number) => (of === 0 ? '-' : `${((100 * n) / of).toFixed(1)}%`);

function report(s: MatchingStats): string {
  const answered = s.offers.accepted + s.offers.declined + s.offers.expired;
  const ttm = s.timeToMatchS ? `p50 ${s.timeToMatchS.p50} s   p95 ${s.timeToMatchS.p95} s` : '-';
  return [
    `rides booked        ${s.booked}`,
    `matched             ${s.matched} (${pct(s.matched, s.booked)})`,
    `no_driver_found     ${s.noDriverFound}`,
    `cancelled searching ${s.cancelledSearching}`,
    `time-to-match       ${ttm}`,
    `offers per ride     ${s.offersPerMatchedRide?.toFixed(1) ?? '-'} (matched rides)`,
    `accept rate         ${pct(s.offers.accepted, answered)} (answered offers)`,
    `expired / declined  ${pct(s.offers.expired, answered)} / ${pct(s.offers.declined, answered)}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { since: { type: 'string', default: '1h' } } });
  const sinceS = seconds(values.since);
  const db = await createDataSource(parseEnv(process.env).DATABASE_URL).initialize();
  try {
    console.log(report(await new MatchingRepository(db).stats(sinceS)));
  } finally {
    await db.destroy();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
