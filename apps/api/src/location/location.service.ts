import type { LocationPoint, LocationResult, NearbyDrivers, Point } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { LocationRepository, type NearbyDriver } from './location.repository';

@Injectable()
export class LocationService {
  constructor(private readonly locations: LocationRepository) {}

  // undefined = the caller is not a verified driver
  record(driverId: string, points: LocationPoint[]): Promise<LocationResult | undefined> {
    return this.locations.record(driverId, points);
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
