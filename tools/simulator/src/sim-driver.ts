import { DRIVER_LOCATION_EVENT, OFFER_UPDATED_EVENT, type Offer, type Point, type Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient, Session } from './api.client';
import { randomPoint } from './geo';
import type { Router } from './osrm.router';
import { positionAt } from './route-playback';

export type DriverDeps = {
  api: ApiClient;
  router: Router;
  speedMps: number;
  tickMs: number;
  jitterMs?: number; // each location emit is held for an independent random 0..jitterMs, so later points reach the server first
  rand: () => number;
  log: (line: string) => void;
};

// One driver, online the whole run: wanders while idle; offered a ride, accepts it, drives to pickup, arrives,
// starts, drives to dropoff and completes. Every tick reports its position over the socket, like the app's
// foreground path (skipped while the socket is down). All REST commands run inside the one loop, so a driver
// never sends two at once. After a socket reconnect or a failed tick it reads GET /me/active-ride and continues
// from that snapshot: a pending offer is accepted, a ride is driven on from its server status.
export class SimDriver {
  private route: Point[];
  private travelled = 0;
  private ride?: Ride;
  private offer?: Offer;
  reconnects = 0;
  recovered = 0;
  discarded = 0;
  // The recordedAt of every point whose ack came back; the newest is what invariant 12 means the stored
  // recorded_at holds after this run
  readonly acked: string[] = [];
  private sent = 0;
  private newestAcked = 0;
  private heldLocations = new Set<NodeJS.Timeout>();
  private sending = new Set<Promise<void>>();
  private resyncDue = false;
  private stopped = false;
  private readonly loop: Promise<void>;

  constructor(
    private readonly session: Session,
    private readonly socket: Socket,
    public position: Point,
    private readonly deps: DriverDeps,
  ) {
    socket.on(OFFER_UPDATED_EVENT, (o: Offer) => this.onOffer(o));
    socket.on('connect', () => {
      this.reconnects++;
      this.resyncDue = true;
    });
    this.route = [position];
    this.loop = this.run();
  }

  get id(): string {
    return this.session.userId;
  }

  // The server only offers available drivers, so a pending offer is always worth taking; the held offer's
  // later status (expired, cancelled) drops it
  private onOffer(o: Offer): void {
    if (o.status === 'pending') this.offer = o;
    else if (o.id === this.offer?.id) this.offer = undefined;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.heldLocations) clearTimeout(timer);
    this.heldLocations.clear();
    await Promise.all(this.sending); // settle in-flight emits: the socket's 5 s timer bounds each
    await this.loop;
    this.socket.disconnect();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (err) {
        this.deps.log(`driver ${this.id.slice(0, 8)}: ${(err as Error).message}`);
        // The held ride may have moved on, or the command may have landed: the snapshot decides
        this.resyncDue = true;
      }
      await new Promise((resolve) => setTimeout(resolve, this.deps.tickMs));
    }
  }

  private async tick(): Promise<void> {
    if (this.resyncDue) await this.resync();
    if (this.offer) {
      const { id } = this.offer;
      this.offer = undefined;
      this.ride = await this.deps.api.accept(this.session.token, id);
      await this.driveTo(this.ride.pickup);
    }
    this.travelled += (this.deps.speedMps * this.deps.tickMs) / 1000;
    const { point, done } = positionAt(this.route, this.travelled);
    this.position = point;
    if (this.socket.connected) {
      const { jitterMs } = this.deps;
      const payload = { ...point, recordedAt: new Date().toISOString() };
      if (jitterMs) {
        // Hold the send for an independent random 0..jitterMs so later points can reach the server first;
        // recordedAt stays at tick time and invariant 12 decides the order at the server. Math.random, not
        // rand: tests narrow rand, which would bias the delays (same reason as the chaos timer).
        void this.sendDelayed(++this.sent, payload, jitterMs);
      } else {
        // A queued ack would stall the loop for 5 s while the socket is down
        await this.socket.timeout(5000).emitWithAck(DRIVER_LOCATION_EVENT, payload);
      }
    }
    if (done) await this.reached();
  }

  private sendDelayed(idx: number, payload: Point & { recordedAt: string }, jitterMs: number): void {
    if (this.stopped) return; // a tick finishing during stop must not schedule a timer past the clear below
    const timer = setTimeout(() => {
      this.heldLocations.delete(timer);
      const task = this.emitAndCheck(idx, payload);
      this.sending.add(task);
      void task.then(() => this.sending.delete(task));
    }, Math.random() * jitterMs);
    this.heldLocations.add(timer);
    timer.unref();
  }

  // An ack only resolves for a point the server handled; socket delivery returns them in arrival order, so if
  // a newer point's ack already came back, this point arrived late and was discarded (invariant 12 kept the
  // newer one). A timeout rejection means no ack came back: not counted.
  private async emitAndCheck(idx: number, payload: Point & { recordedAt: string }): Promise<void> {
    if (!this.socket.connected || this.stopped) return;
    try {
      await this.socket.timeout(5000).emitWithAck(DRIVER_LOCATION_EVENT, payload);
    } catch {
      return;
    }
    this.acked.push(payload.recordedAt);
    if (idx < this.newestAcked) this.discarded++;
    else this.newestAcked = idx;
  }

  private async resync(): Promise<void> {
    const { driver: ride, offer } = await this.deps.api.activeRides(this.session.token);
    this.resyncDue = false;
    if (offer) this.offer = offer; // never clear: a push may have landed during the fetch; a stale one 409s and resyncs
    const held = this.ride;
    this.ride = ride ?? undefined;
    if (ride && (ride.id !== held?.id || ride.status !== held.status)) {
      this.recovered++;
      await this.driveTo(ride.status === 'in_progress' ? ride.dropoff : ride.pickup);
    }
  }

  private async reached(): Promise<void> {
    let ride = this.ride;
    if (!ride) return this.driveTo(randomPoint(this.deps.rand)); // wander
    if (ride.status === 'driver_assigned') this.ride = ride = await this.move(ride, 'arrive');
    if (ride.status === 'driver_arrived') {
      this.ride = await this.move(ride, 'start');
      return this.driveTo(ride.dropoff);
    }
    await this.move(ride, 'complete');
    this.ride = undefined;
  }

  private move(ride: Ride, action: string): Promise<Ride> {
    return this.deps.api.move(this.session.token, ride.id, action);
  }

  // shortcut: a router failure right after accept keeps the old route, so the driver reaches pickup from the wrong place; the server doesn't check position, fix it if a test ever does
  private async driveTo(to: Point): Promise<void> {
    this.route = await this.deps.router(this.position, to);
    this.travelled = 0;
  }
}
