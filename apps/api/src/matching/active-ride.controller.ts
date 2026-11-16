import type { ActiveRides } from '@lern/contracts';
import { Controller, Get } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { RidesService } from '../rides/rides.service';
import { ActiveRidesDto } from './dto/active-rides.dto';
import { MatchingService } from './matching.service';

// The reconnect snapshot: what the caller is riding and driving right now, and the offer they hold. No @Roles: it
// only ever returns the caller's own. Lives in matching because offers do (rides can't import matching).
@Controller('me')
export class ActiveRideController {
  constructor(
    private readonly matching: MatchingService,
    private readonly rides: RidesService,
  ) {}

  @Get('active-ride')
  @ZodSerializerDto(ActiveRidesDto)
  async active(@CurrentUser() user: AuthUser): Promise<ActiveRides> {
    const [rides, offer] = await Promise.all([this.rides.active(user.id), this.matching.pendingOffer(user.id)]);
    return { ...rides, offer };
  }
}
