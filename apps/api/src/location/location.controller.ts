import type { LocationResult, NearbyDrivers } from '@lern/contracts';
import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { VerifiedDriver } from '../drivers/verified-driver.guard';
import { LocationResultDto } from './dto/location-result.dto';
import { NearbyDriversDto } from './dto/nearby-drivers.dto';
import { NearbyDriversQueryDto } from './dto/nearby-drivers-query.dto';
import { RecordLocationsDto } from './dto/record-locations.dto';
import { LocationService } from './location.service';

@Controller('drivers')
export class LocationController {
  constructor(private readonly location: LocationService) {}

  // No @Idempotent: replaying a batch never moves the position backwards
  @Post('me/locations')
  @HttpCode(200)
  @VerifiedDriver()
  @ZodSerializerDto(LocationResultDto)
  async record(@CurrentUser() user: AuthUser, @Body() body: RecordLocationsDto): Promise<LocationResult> {
    const result = await this.location.record(user.id, body.points);
    // Banned between the guard and the query
    if (!result) throw new ForbiddenException('Driver is not verified');
    return result;
  }

  // Polled by the rider app every ~5 s (decided 2026-10-27: pull, not socket push; no state per rider).
  // shortcut: no rate limit, a rider can poll fast or sweep the city; add one with the socket limit before M8.
  @Get('nearby')
  @Roles('rider')
  @ZodSerializerDto(NearbyDriversDto)
  nearby(@Query() query: NearbyDriversQueryDto): Promise<NearbyDrivers> {
    return this.location.forRider(query);
  }
}
