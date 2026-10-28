import { type Router, Simulation } from '@lern/simulator';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { requireEnv } from './env';
import { bootApp } from './support/actors';

let app: INestApplication<App>;
let url: string;

beforeAll(async () => {
  app = await bootApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(() => app.close());

const waitFor = async (done: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !done(); await new Promise((resolve) => setTimeout(resolve, 20))) {
    if (Date.now() > end) throw new Error(`not done within ${ms} ms`);
  }
};
// No OSRM in CI: drive in a straight line
const straight: Router = (from, to) => Promise.resolve([from, to]);

it('drives a booked ride from searching to completed through the real API and socket', async () => {
  const sim = await Simulation.start({
    api: url,
    databaseUrl: requireEnv('DATABASE_URL'),
    router: straight,
    drivers: 2,
    riders: 1,
    speed: 200, // ~1.6 km/s: a cross-town trip in a few seconds
    tickMs: 50,
    pauseMs: 60_000, // one ride per rider in this test
    log: () => undefined,
  });
  const [rider] = sim.riders;
  let summary;
  try {
    await waitFor(() => rider.completed >= 1, 20_000);
  } finally {
    summary = await sim.stop();
  }

  const done = rider.updates.find((r) => r.status === 'completed');
  if (!done) throw new Error('no completed ride');
  const mine = rider.updates.filter((r) => r.id === done.id);
  expect(mine.map((r) => r.status)).toEqual(['searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed']);
  expect(mine.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
  expect(rider.positions.some((p) => p.rideId === done.id)).toBe(true);
  expect(summary).toMatchObject({ completed: 1, stale: 0 });

  const [row] = await app
    .get(DataSource)
    .query<{ status: string; driver_id: string }[]>('SELECT status, driver_id FROM rides WHERE id = $1', [done.id]);
  expect(row.status).toBe('completed');
  expect(sim.drivers.map((d) => d.id)).toContain(row.driver_id);
}, 30_000);
