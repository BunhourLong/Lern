import type { ActiveRides } from '@lern/contracts';
import { Controller, Get } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ActiveRidesDto } from './dto/active-rides.dto';
import { RidesService } from './rides.service';

// The reconnect snapshot: what the caller is riding and driving right now. No @Roles: it only ever
// returns the caller's own rides.
@Controller('me')
export class ActiveRideController {
  constructor(private readonly rides: RidesService) {}

  @Get('active-ride')
  @ZodSerializerDto(ActiveRidesDto)
  active(@CurrentUser() user: AuthUser): Promise<ActiveRides> {
    return this.rides.active(user.id);
  }
}
