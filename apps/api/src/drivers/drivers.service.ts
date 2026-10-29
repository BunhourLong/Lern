import type { ApplyDriver, Availability, DriverAvailabilityAction, DriverProfile, DriverVerification } from '@lern/contracts';
import { ConflictException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { DriversRepository } from './drivers.repository';

@Injectable()
export class DriversService {
  constructor(
    private readonly db: DataSource,
    private readonly drivers: DriversRepository,
    private readonly users: UsersService,
  ) {}

  // Profile and role in one transaction: never a driver row without the role, or the reverse
  async apply(userId: string, input: ApplyDriver): Promise<DriverProfile> {
    const profile = await this.db.transaction(async (tx) => {
      const created = await this.drivers.insert(tx, userId, input);
      if (created) await this.users.grantRole(tx, userId, 'driver');
      return created;
    });
    if (!profile) throw new ConflictException('Already applied to drive');
    return profile;
  }

  async profile(userId: string): Promise<DriverProfile> {
    const profile = await this.drivers.find(userId);
    if (!profile) throw new NotFoundException('Not a driver');
    return profile;
  }

  verification(userId: string): Promise<DriverVerification | undefined> {
    return this.drivers.verification(userId);
  }

  // Going online needs a verified driver; going offline doesn't (a suspended driver must be able to stop).
  // Asking for the state the driver is already in changes nothing, so a retried toggle never fails.
  async setOnline(userId: string, online: boolean): Promise<Availability> {
    const state = await this.drivers.state(userId);
    if (!state) throw new NotFoundException('Not a driver');
    if (online && state.verification !== 'verified') {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Driver is not verified',
        verification: state.verification,
      });
    }
    const target = online ? 'available' : 'offline';
    if (state.availability === target) return { availability: target };
    if (await this.drivers.move(this.db.manager, userId, online ? 'go_online' : 'go_offline')) return { availability: target };
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      message: "Can't change availability while holding an offer or on a trip",
      availability: (await this.drivers.state(userId))?.availability,
    });
  }

  // For the offer and ride changes that move a driver, inside their transaction
  move(m: EntityManager, driverId: string, action: DriverAvailabilityAction): Promise<boolean> {
    return this.drivers.move(m, driverId, action);
  }
}
