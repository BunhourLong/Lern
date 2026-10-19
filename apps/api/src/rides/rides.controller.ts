import type { Ride } from '@lern/contracts';
import { Body, Controller, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideDto } from './dto/ride.dto';
import { RidesService } from './rides.service';

@Controller('rides')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post()
  @Roles('rider')
  @Idempotent()
  @ZodSerializerDto(RideDto)
  book(@CurrentUser() user: AuthUser, @Body() body: CreateRideDto): Promise<Ride> {
    return this.rides.book(user.id, body.quoteId);
  }
}
