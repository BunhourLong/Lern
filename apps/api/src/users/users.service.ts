import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findOrCreateByPhone(phone: string): Promise<string> {
    return this.users.upsertByPhone(phone);
  }
}
