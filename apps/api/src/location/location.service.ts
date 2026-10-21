import type { LocationPoint, LocationResult } from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { LocationRepository } from './location.repository';

@Injectable()
export class LocationService {
  constructor(private readonly locations: LocationRepository) {}

  // undefined = the caller is not a verified driver
  record(driverId: string, points: LocationPoint[]): Promise<LocationResult | undefined> {
    return this.locations.record(driverId, points);
  }
}
