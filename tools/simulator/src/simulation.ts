import type { Socket } from 'socket.io-client';
import { ApiClient } from './api.client';
import { randomPoint } from './geo';
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
  chaosMs?: number; // every chaosMs one random connected client loses its socket abruptly; socket.io reconnects it
  rand?: () => number;
  log?: (line: string) => void;
};
export type Summary = { completed: number; positions: number; stale: number; rejected: number; reconnects: number; recovered: number };

const CITY_SPEED_MPS = 8;

export class Simulation {
  readonly drivers: SimDriver[] = [];
  readonly riders: SimRider[] = [];

  private chaos?: NodeJS.Timeout;

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
    const sockets: Socket[] = [];
    try {
      for (let i = 0; i < o.drivers; i++) {
        const p = phone();
        const first = await api.signIn(p);
        await api.applyDriver(first.token);
        await verifyDriver(o.databaseUrl, first.userId);
        const session = await api.signIn(p); // a fresh token carries the driver role
        await api.goOnline(session.token);
        const socket = await api.connect(session.token);
        sockets.push(socket);
        sim.drivers.push(
          new SimDriver(session, socket, randomPoint(rand), {
            api,
            router: o.router,
            speedMps: CITY_SPEED_MPS * o.speed,
            tickMs: o.tickMs ?? 1000,
            rand,
            log,
          }),
        );
      }
      for (let i = 0; i < o.riders; i++) {
        const session = await api.signIn(phone());
        const socket = await api.connect(session.token);
        sockets.push(socket);
        sim.riders.push(
          new SimRider(session, socket, {
            api,
            pauseMs: o.pauseMs ?? 5000,
            rand,
            log,
          }),
        );
      }
      if (o.chaosMs) {
        // engine.close(), not socket.disconnect(): that is client-initiated and never reconnects. Only connected
        // sockets: closing one mid-reconnect leaves the manager waiting out its connect timeout. Math.random, not
        // rand: tests narrow rand, which would bias the victim.
        sim.chaos = setInterval(() => {
          const up = sockets.filter((s) => s.connected);
          up[Math.floor(Math.random() * up.length)]?.io.engine.close();
        }, o.chaosMs).unref();
      }
    } catch (err) {
      await sim.stop();
      throw err;
    }
    return sim;
  }

  async stop(): Promise<Summary> {
    clearInterval(this.chaos);
    const actors = [...this.drivers, ...this.riders];
    await Promise.all(actors.map((a) => a.stop()));
    return {
      reconnects: actors.reduce((s, a) => s + a.reconnects, 0),
      recovered: actors.reduce((s, a) => s + a.recovered, 0),
      completed: this.riders.reduce((s, r) => s + r.completed, 0),
      positions: this.riders.reduce((s, r) => s + r.positions.length, 0),
      stale: this.riders.reduce((s, r) => s + r.stale, 0),
      rejected: this.riders.reduce((s, r) => s + r.rejected, 0),
    };
  }
}
