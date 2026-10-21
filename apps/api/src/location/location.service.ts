import type { LocationPoint, LocationResult, Point } from '@lern/contracts';
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
}
