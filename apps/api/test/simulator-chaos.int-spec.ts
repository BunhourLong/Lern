import { type Router, Simulation } from '@lern/simulator';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { violations } from './support/invariants';
import { bootApp } from './support/actors';
import { isolatedDatabase } from './support/isolated-database';

let app: INestApplication<App>;
let url: string;
let databaseUrl: string;

// Own database: drivers stopped by another suite keep a fresh location for 60 s and would soak up 15 s offers
beforeAll(async () => {
  databaseUrl = await isolatedDatabase();
  app = await bootApp({}, { DATABASE_URL: databaseUrl, MATCHING_WORKER: true, SWEEP_INTERVAL_MS: 500 });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(() => app.close());

const waitFor = async (done: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !done(); await new Promise((resolve) => setTimeout(resolve, 20))) {
    if (Date.now() > end) throw new Error(`not done within ${ms} ms`);
  }
};
const straight: Router = (from, to) => Promise.resolve([from, to]);

it('clients recover through the reconnect flow while sockets are dropped at random', async () => {
  const sim = await Simulation.start({
    api: url,
    databaseUrl,
    router: straight,
    drivers: 2,
    riders: 2,
    speed: 200,
    tickMs: 50,
    pauseMs: 100,
    chaosMs: 100,
    rand: () => 0.45 + Math.random() * 0.1,
    log: () => undefined,
  });
  const recovered = () => sim.riders.reduce((s, r) => s + r.recovered, 0);
  const completed = () => sim.riders.reduce((s, r) => s + r.completed, 0);
  try {
    await waitFor(
      () =>
        completed() >= 3 &&
        recovered() >= 1 &&
        sim.riders.some((r) => r.reconnects >= 1) &&
        sim.drivers.some((d) => d.reconnects >= 1),
      40_000,
    );
  } finally {
    await sim.stop();
  }

  const db = app.get(DataSource);
  const rows = await db.query<{ id: string; status: string; version: number; driver_id: string | null }[]>(
    'SELECT id, status, version, driver_id FROM rides',
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const driverIds = sim.drivers.map((d) => d.id);
  for (const rider of sim.riders) {
    for (const id of new Set(rider.updates.map((r) => r.id))) {
      const mine = rider.updates.filter((r) => r.id === id);
      const held = mine[mine.length - 1];
      const row = byId.get(id)!;
      if (['completed', 'cancelled', 'no_driver_found'].includes(held.status)) {
        expect([held.status, held.version]).toEqual([row.status, Number(row.version)]);
      } else {
        expect(held.version).toBeLessThanOrEqual(Number(row.version));
      }
      if (held.status === 'completed') expect(driverIds).toContain(row.driver_id);
    }
  }
  expect(await violations(db)).toEqual([]);
}, 60_000);
