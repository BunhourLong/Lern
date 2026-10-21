import type { Ride } from '@lern/contracts';
import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { VerifiedDriver } from '../drivers/verified-driver.guard';
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

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @VerifiedDriver()
  @Idempotent()
  @ZodSerializerDto(RideDto)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Ride> {
    return this.rides.accept(user.id, id);
  }
}
