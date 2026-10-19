import type { Me, Role } from '@lern/contracts';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findOrCreateByPhone(phone: string): Promise<string> {
    return this.users.upsertByPhone(phone);
  }

  // Takes the caller's transaction so the grant commits or rolls back with the change that earned it
  grantRole(tx: EntityManager, userId: string, role: Role): Promise<void> {
    return this.users.grantRole(tx, userId, role);
  }

  roles(userId: string): Promise<Role[]> {
    return this.users.roles(userId);
  }

  async me(userId: string): Promise<Me> {
    const me = await this.users.findMe(userId);
    if (!me) throw new NotFoundException();
    return me;
  }
}
