import {
  DRIVER_CONNECTIVITY_EVENT,
  DRIVER_POSITION_EVENT,
  type DriverConnectivity,
  type DriverPosition,
  driverConnectivitySchema,
  RIDE_UPDATED_EVENT,
  type Ride,
} from '@lern/contracts';
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
// ride:updated snapshots (an event not newer than the last one seen counts as stale), driver positions and
// driver:connectivity signals (newest lastSeenAt per ride; built in SQL, so parsed here and counted when malformed).
// On every socket reconnect it reads GET /me/active-ride (like mobile) and applies the snapshot only if it is
// newer than what it holds, so a terminal event missed while the socket was down still ends the ride.
// shortcut: updates/positions grow for the whole run; keep counts only if long runs need it (M8 load test).
export class SimRider {
  completed = 0;
  stale = 0;
  rejected = 0;
  reconnects = 0;
  recovered = 0;
  readonly updates: Ride[] = [];
  readonly positions: DriverPosition[] = [];
  readonly connectivity: DriverConnectivity[] = [];
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
    socket.on(DRIVER_CONNECTIVITY_EVENT, (raw: unknown) => this.onConnectivity(raw));
    // Already connected when passed in, so this fires only on reconnects
    socket.on('connect', () => void this.resync());
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

  private async resync(): Promise<void> {
    this.reconnects++;
    try {
      const { token } = this.session;
      const { rider } = await this.deps.api.activeRides(token);
      const ride = rider ?? (this.current && (await this.deps.api.ride(token, this.current.id)));
      // Compared after the awaits: an event delivered during the fetch wins
      const held = this.updates.findLast((r) => r.id === ride?.id)?.version ?? 0;
      if (!ride || ride.version <= held) return;
      this.recovered++;
      this.onUpdate(ride);
    } catch (err) {
      this.deps.log(`rider ${this.session.userId.slice(0, 8)}: resync failed: ${(err as Error).message}`);
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

  private onConnectivity(raw: unknown): void {
    const parsed = driverConnectivitySchema.safeParse(raw);
    if (!parsed.success) {
      this.rejected++;
      return;
    }
    const c = parsed.data;
    const last = this.connectivity.findLast((x) => x.rideId === c.rideId);
    if (last && Date.parse(c.lastSeenAt) <= Date.parse(last.lastSeenAt)) {
      this.stale++;
      return;
    }
    this.connectivity.push(c);
    this.deps.log(`ride ${c.rideId.slice(0, 8)}: driver ${c.stale ? 'went silent' : 'is back'}`);
  }
}
