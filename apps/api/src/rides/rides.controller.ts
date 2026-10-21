import type { Ride } from '@lern/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { VerifiedDriver } from '../drivers/verified-driver.guard';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideDto } from './dto/ride.dto';
import { RidesService } from './rides.service';

const DRIVER_STEPS = { arrive: 'arrive', start: 'start', complete: 'complete' } as const;

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

  // No @Roles: the ownership check in the query is what decides
  @Get(':id')
  @ZodSerializerDto(RideDto)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Ride> {
    return this.rides.get(user.id, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @VerifiedDriver()
  @Idempotent()
  @ZodSerializerDto(RideDto)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Ride> {
    return this.rides.accept(user.id, id);
  }

  // Declared after accept: Express matches routes in order, so /accept never reaches this one
  @Post(':id/:action')
  @HttpCode(HttpStatus.OK)
  @Roles('driver')
  @Idempotent()
  @ZodSerializerDto(RideDto)
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action', new ParseEnumPipe(DRIVER_STEPS)) action: keyof typeof DRIVER_STEPS,
  ): Promise<Ride> {
    return this.rides.step(user.id, id, action);
  }
}
