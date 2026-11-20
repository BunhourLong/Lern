import type { Rating, Receipt, Ride, RideHistoryPage } from '@lern/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { RatingDto } from './dto/rating.dto';
import { ReceiptDto } from './dto/receipt.dto';
import { RideDto } from './dto/ride.dto';
import { RideHistoryPageDto } from './dto/ride-history-page.dto';
import { RideHistoryQueryDto } from './dto/ride-history-query.dto';
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

  // Finished rides on the side `as` names, newest first; no @Roles: the WHERE decides, like get
  @Get()
  @ZodSerializerDto(RideHistoryPageDto)
  list(@CurrentUser() user: AuthUser, @Query() query: RideHistoryQueryDto): Promise<RideHistoryPage> {
    return this.rides.history(user.id, query);
  }

  // No @Roles: the ownership check in the query is what decides
  @Get(':id')
  @ZodSerializerDto(RideDto)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Ride> {
    return this.rides.get(user.id, id);
  }

  // No @Roles: the query decides, like get; its driver block is NULL for the rider, so the commission never reaches them
  @Get(':id/receipt')
  @ZodSerializerDto(ReceiptDto)
  receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Receipt> {
    return this.rides.receipt(user.id, id);
  }

  // Rider or assigned driver; no @Roles, the guarded UPDATE decides. Not @VerifiedDriver either: a
  // suspended driver must still be able to drop a ride they can no longer serve.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ZodSerializerDto(RideDto)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelRideDto,
  ): Promise<Ride> {
    return this.rides.cancel(user.id, id, body.reason);
  }

  // Rider or driver of a completed ride, within 7 days; the query decides, like cancel. Declared before the step route.
  @Post(':id/rating')
  @Idempotent()
  @ZodSerializerDto(RatingDto)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateRatingDto,
  ): Promise<Rating> {
    return this.rides.rate(user.id, id, body);
  }

  // Declared after cancel and rating: Express matches routes in order, so it never reaches this one
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
