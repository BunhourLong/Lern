import { parseArgs } from 'node:util';
import { z } from 'zod';
import { osrmRouter } from './osrm.router';
import { Simulation } from './simulation';

// pnpm sim --drivers 5 --riders 3 --speed 4 [--chaos-ms 5000] [--jitter-ms 200]   (dev stack + api with OTP_PROVIDER=dev; Ctrl-C prints the summary)
const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:3000' },
    osrm: { type: 'string', default: 'http://127.0.0.1:5050' },
    drivers: { type: 'string', default: '5' },
    riders: { type: 'string', default: '3' },
    speed: { type: 'string', default: '1' },
    'chaos-ms': { type: 'string' }, // drop one random socket this often; clients must recover
    'jitter-ms': { type: 'string' }, // hold ride updates and location emits for a random 0..N ms; ordering rules must hold
  },
});
const count = z.coerce.number().int().min(1).max(500);
const flags = z
  .object({
    api: z.url(),
    osrm: z.url(),
    drivers: count,
    riders: count,
    speed: z.coerce.number().min(0.1).max(1000),
    'chaos-ms': z.coerce.number().int().min(1).optional(),
    'jitter-ms': z.coerce.number().int().min(1).optional(),
  })
  .parse(values);
const databaseUrl = z.string().min(1, 'DATABASE_URL is not set (read from apps/api/.env)').parse(process.env.DATABASE_URL);

async function main(): Promise<void> {
  const sim = await Simulation.start({ ...flags, chaosMs: flags['chaos-ms'], jitterMs: flags['jitter-ms'], databaseUrl, router: osrmRouter(flags.osrm) });
  console.log(`running: ${flags.drivers} drivers, ${flags.riders} riders; Ctrl-C to stop`);
  process.once('SIGINT', () => {
    void sim.stop().then((summary) => console.log(JSON.stringify(summary)));
  });
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
