import type { ApplyDriver, Availability, DriverAvailabilityAction, DriverProfile, DriverVerification } from '@lern/contracts';
import { ConflictException, ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { DRIVERS_CONFIG, type DriversConfig } from './drivers.config';
import { DriversRepository } from './drivers.repository';

@Injectable()
export class DriversService {
  constructor(
    private readonly db: DataSource,
    private readonly drivers: DriversRepository,
    private readonly users: UsersService,
    @Inject(DRIVERS_CONFIG) private readonly config: DriversConfig,
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
    // Going offline never checks: a driver in debt must be able to stop
    const limitMinor = this.config.DRIVER_DEBT_LIMIT_MINOR;
    if (online && !(await this.drivers.withinDebtLimit(userId, limitMinor))) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        code: 'DEBT_LIMIT',
        message: 'Driver owes more commission than the limit',
        limitMinor,
        currency: 'KHR',
      });
    }
    if (await this.drivers.move(this.db.manager, userId, online ? 'go_online' : 'go_offline')) return { availability: target };
    // The move missed: a simultaneous identical request (a double tap) may have made it first
    const availability = (await this.drivers.state(userId))?.availability;
    if (availability === target) return { availability: target };
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      message: "Can't change availability while holding an offer or on a trip",
      availability,
    });
  }

  // A ride ended, inside its transaction: back to available, or offline once the commission owed is past the limit
  async endTrip(m: EntityManager, driverId: string): Promise<boolean> {
    const within = await this.drivers.withinDebtLimit(driverId, this.config.DRIVER_DEBT_LIMIT_MINOR, m);
    return this.drivers.move(m, driverId, within ? 'finish' : 'debt_stop');
  }

  // For the offer and ride changes that move a driver, inside their transaction
  move(m: EntityManager, driverId: string, action: DriverAvailabilityAction): Promise<boolean> {
    return this.drivers.move(m, driverId, action);
  }
}
