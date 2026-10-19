import type { Me } from '@lern/contracts';
import { Controller, Get } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { MeDto } from './dto/me.dto';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Roles come from the database, so this is fresher than the access token's copy
  @Get()
  @ZodSerializerDto(MeDto)
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.me(user.id);
  }
}
