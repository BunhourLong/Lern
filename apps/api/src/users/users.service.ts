import type { Me, Role } from '@lern/contracts';
import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findOrCreateByPhone(phone: string): Promise<string> {
    return this.users.upsertByPhone(phone);
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
