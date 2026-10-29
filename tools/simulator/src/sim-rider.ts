import { DRIVER_POSITION_EVENT, type DriverPosition, RIDE_UPDATED_EVENT, type Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient, Session } from './api.client';
import { randomPoint } from './geo';

export type RiderDeps = {
  api: ApiClient;
  pauseMs: number;
  rand: () => number;
  log: (line: string) => void;
};

const DONE = new Set<Ride['status']>(['completed', 'cancelled', 'no_driver_found']);

// One rider: books a ride, waits until it ends, pauses, books again. Keeps what the socket delivered:
// ride:updated snapshots (an event not newer than the last one seen counts as stale) and driver positions.
// shortcut: updates/positions grow for the whole run; keep counts only if long runs need it (M8 load test).
export class SimRider {
  completed = 0;
  stale = 0;
  readonly updates: Ride[] = [];
  readonly positions: DriverPosition[] = [];
  private current?: Ride;
  private ended?: () => void;
  private stopped = false;
  private wake?: () => void;
  private readonly loop: Promise<void>;

  constructor(
    private readonly session: Session,
    private readonly socket: Socket,
    private readonly deps: RiderDeps,
  ) {
    socket.on(RIDE_UPDATED_EVENT, (ride: Ride) => this.onUpdate(ride));
    socket.on(DRIVER_POSITION_EVENT, (p: DriverPosition) => this.positions.push(p));
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ended?.();
    this.wake?.();
    await this.loop;
    this.socket.disconnect();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const ended = new Promise<void>((resolve) => (this.ended = resolve));
        this.current = await this.deps.api.book(this.session.token, randomPoint(this.deps.rand), randomPoint(this.deps.rand));
        await ended;
      } catch (err) {
        this.deps.log(`rider ${this.session.userId.slice(0, 8)}: ${(err as Error).message}`);
      }
      if (this.stopped) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, this.deps.pauseMs).unref();
      });
    }
  }

  private onUpdate(ride: Ride): void {
    const last = this.updates.findLast((r) => r.id === ride.id);
    if (last && ride.version <= last.version) {
      this.stale++;
      return;
    }
    this.updates.push(ride);
    this.deps.log(`ride ${ride.id.slice(0, 8)} → ${ride.status} (v${ride.version})`);
    if (ride.id === this.current?.id && DONE.has(ride.status)) {
      if (ride.status === 'completed') this.completed++;
      this.ended?.();
    }
  }
}
