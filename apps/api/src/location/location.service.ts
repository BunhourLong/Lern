import {
  DRIVER_POSITION_EVENT,
  type DriverPosition,
  type LocationPoint,
  type LocationResult,
  type NearbyDrivers,
  type Point,
} from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { consume } from '../shared/redis/rate-limit';
import { LocationRepository, type NearbyDriver } from './location.repository';

@Injectable()
export class LocationService {
  constructor(
    private readonly locations: LocationRepository,
    private readonly realtime: RealtimeGateway,
    private readonly redis: Redis,
  ) {}

  // undefined = the caller is not a verified driver
  async record(driverId: string, points: LocationPoint[]): Promise<LocationResult | undefined> {
    const recorded = await this.locations.record(driverId, points);
    if (!recorded) return undefined;
    const { dropped, share } = recorded;
    // Straight to the rider, not via the outbox: a position isn't a state change and the next one follows in
    // seconds. One per driver per 2 s across instances; a throttled point is just not shared, and so is one
    // while Redis is down (the point is already stored; /health reports the outage).
    const waitS = () => consume(this.redis, `rl:driver-position:${driverId}`, 1, 2).catch(() => 1);
    if (share && (await waitS()) === 0) {
      const { riderId, ...rest } = share;
      const position: DriverPosition = { ...rest, recordedAt: new Date(rest.recordedAt).toISOString() };
      this.realtime.server.to(`user:${riderId}`).emit(DRIVER_POSITION_EVENT, position);
    }
    return { dropped };
  }

  // Nearest available drivers by straight line; road ETA re-ranking is M4's
  nearby(p: Point, radiusM: number, limit: number): Promise<NearbyDriver[]> {
    return this.locations.nearby(p, radiusM, limit);
  }

  // What a rider's map shows: positions rounded to 3 decimals (~110 m), no ids (PLAN-notes: rider nearby view)
  async forRider(p: Point): Promise<NearbyDrivers> {
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const drivers = await this.nearby(p, 3000, 10);
    return { drivers: drivers.map((d) => ({ lat: round(d.lat), lng: round(d.lng) })) };
  }
}
