import type { Offer, Ride } from '@lern/contracts';
import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { VerifiedDriver } from '../drivers/verified-driver.guard';
import { RideDto } from '../rides/dto/ride.dto';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { OfferDto } from './dto/offer.dto';
import { MatchingService } from './matching.service';

// The offer's driver answers here; everyone else gets 404 (ownership is in each query)
@Controller('offers')
export class OffersController {
  constructor(private readonly matching: MatchingService) {}

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @VerifiedDriver()
  @Idempotent()
  @ZodSerializerDto(RideDto)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Ride> {
    return this.matching.accept(user.id, id);
  }

  // Not @VerifiedDriver: a driver suspended while holding an offer can still turn it down
  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @Roles('driver')
  @Idempotent()
  @ZodSerializerDto(OfferDto)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Offer> {
    return this.matching.decline(user.id, id);
  }
}
