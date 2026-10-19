import type { ApplyDriver, DriverProfile, DriverVerification } from '@lern/contracts';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
}
