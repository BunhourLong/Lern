import type { Ride } from '@lern/contracts';
import { ApiClient } from './api.client';
import { randomPoint } from './geo';
import { nearestIdle } from './hand-off';
import type { Router } from './osrm.router';
import { SimDriver } from './sim-driver';
import { SimRider } from './sim-rider';
import { verifyDriver } from './verify-driver';

export type SimOptions = {
  api: string;
  databaseUrl: string;
  router: Router;
  drivers: number;
  riders: number;
  speed: number; // playback multiplier on a ~29 km/h city speed; recordedAt stays the real clock
  tickMs?: number;
  pauseMs?: number; // between a rider's rides
  rand?: () => number;
  log?: (line: string) => void;
};
export type Summary = { completed: number; positions: number; stale: number };

const CITY_SPEED_MPS = 8;

export class Simulation {
  readonly drivers: SimDriver[] = [];
  readonly riders: SimRider[] = [];
  private readonly queue: Ride[] = [];

  private constructor() {}

  static async start(o: SimOptions): Promise<Simulation> {
    const sim = new Simulation();
    const api = new ApiClient(o.api);
    const rand = o.rand ?? Math.random;
    const log = o.log ?? console.log;
    // Fresh users every run: +8559 and a random 7-digit block
    const base = Math.floor(rand() * 9_000_000);
    let n = 0;
    const phone = () => `+8559${String(base + n++).padStart(7, '0')}`;
    try {
      for (let i = 0; i < o.drivers; i++) {
        const p = phone();
        const first = await api.signIn(p);
        await api.applyDriver(first.token);
        await verifyDriver(o.databaseUrl, first.userId);
        const session = await api.signIn(p); // a fresh token carries the driver role
        sim.drivers.push(
          new SimDriver(session, await api.connect(session.token), randomPoint(rand), {
            api,
            router: o.router,
            speedMps: CITY_SPEED_MPS * o.speed,
            tickMs: o.tickMs ?? 1000,
            rand,
            log,
            onIdle: () => sim.dispatch(),
          }),
        );
      }
      for (let i = 0; i < o.riders; i++) {
        const session = await api.signIn(phone());
        sim.riders.push(
          new SimRider(session, await api.connect(session.token), {
            api,
            pauseMs: o.pauseMs ?? 5000,
            rand,
            log,
            onBooked: (ride) => {
              sim.queue.push(ride);
              sim.dispatch();
            },
          }),
        );
      }
    } catch (err) {
      await sim.stop();
      throw err;
    }
    return sim;
  }

  async stop(): Promise<Summary> {
    await Promise.all([...this.drivers, ...this.riders].map((a) => a.stop()));
    return {
      completed: this.riders.reduce((s, r) => s + r.completed, 0),
      positions: this.riders.reduce((s, r) => s + r.positions.length, 0),
      stale: this.riders.reduce((s, r) => s + r.stale, 0),
    };
  }

  // Oldest ride first, to the nearest idle driver; rides wait when every driver is busy
  private dispatch(): void {
    for (const ride of [...this.queue]) {
      const driver = nearestIdle(this.drivers, ride.pickup);
      if (!driver) return;
      this.queue.shift();
      driver.assign(ride);
    }
  }
}
