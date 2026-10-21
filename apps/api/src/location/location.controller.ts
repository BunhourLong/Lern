import type { LocationResult } from '@lern/contracts';
import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { VerifiedDriver } from '../drivers/verified-driver.guard';
import { LocationResultDto } from './dto/location-result.dto';
import { RecordLocationsDto } from './dto/record-locations.dto';
import { LocationService } from './location.service';

// No @Idempotent: replaying a batch never moves the position backwards
@Controller('drivers/me/locations')
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Post()
  @HttpCode(200)
  @VerifiedDriver()
  @ZodSerializerDto(LocationResultDto)
  async record(@CurrentUser() user: AuthUser, @Body() body: RecordLocationsDto): Promise<LocationResult> {
    const result = await this.location.record(user.id, body.points);
    // Banned between the guard and the query
    if (!result) throw new ForbiddenException('Driver is not verified');
    return result;
  }
}
