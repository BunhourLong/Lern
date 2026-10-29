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
  rand: () => number;
  log: (line: string) => void;
};

// One driver, online the whole run: wanders while idle; offered a ride, accepts it, drives to pickup, arrives,
// starts, drives to dropoff and completes. Every tick reports its position over the socket, like the app's
// foreground path. All REST commands run inside the one loop, so a driver never sends two at once.
export class SimDriver {
  private route: Point[];
  private travelled = 0;
  private ride?: Ride;
  private offer?: Offer;
  private stopped = false;
  private readonly loop: Promise<void>;

  constructor(
    private readonly session: Session,
    private readonly socket: Socket,
    public position: Point,
    private readonly deps: DriverDeps,
  ) {
    socket.on(OFFER_UPDATED_EVENT, (o: Offer) => this.onOffer(o));
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
    await this.loop;
    this.socket.disconnect();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (err) {
        // shortcut: a ride whose command failed is dropped (its rider waits); re-queue it when M5's chaos mode makes failures normal
        const dropped = this.ride ? `, ride ${this.ride.id.slice(0, 8)} dropped` : '';
        this.deps.log(`driver ${this.id.slice(0, 8)}: ${(err as Error).message}${dropped}`);
        // An offer that arrived while the failing tick ran is still this driver's: the next tick accepts it
        this.ride = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, this.deps.tickMs));
    }
  }

  private async tick(): Promise<void> {
    if (this.offer) {
      const { id } = this.offer;
      this.offer = undefined;
      this.ride = await this.deps.api.accept(this.session.token, id);
      await this.driveTo(this.ride.pickup);
    }
    this.travelled += (this.deps.speedMps * this.deps.tickMs) / 1000;
    const { point, done } = positionAt(this.route, this.travelled);
    this.position = point;
    await this.socket.timeout(5000).emitWithAck(DRIVER_LOCATION_EVENT, { ...point, recordedAt: new Date().toISOString() });
    if (done) await this.reached();
  }

  private async reached(): Promise<void> {
    const ride = this.ride;
    if (!ride) return this.driveTo(randomPoint(this.deps.rand)); // wander
    if (ride.status === 'driver_assigned') {
      await this.move(ride, 'arrive');
      this.ride = await this.move(ride, 'start');
      return this.driveTo(ride.dropoff);
    }
    await this.move(ride, 'complete');
    this.ride = undefined;
  }

  private move(ride: Ride, action: string): Promise<Ride> {
    return this.deps.api.move(this.session.token, ride.id, action);
  }

  private async driveTo(to: Point): Promise<void> {
    this.route = await this.deps.router(this.position, to);
    this.travelled = 0;
  }
}
