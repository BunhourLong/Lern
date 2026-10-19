import type { DriverProfile } from '@lern/contracts';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ApplyDriverDto } from './dto/apply-driver.dto';
import { DriverProfileDto } from './dto/driver-profile.dto';
import { DriversService } from './drivers.service';

// "me" routes only: the caller's id comes from the token, so there is no other driver's id to tamper with
@Controller('drivers/me')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  // Any signed-in user may apply; the driver role is granted here, so no @Roles
  @Post()
  @ZodSerializerDto(DriverProfileDto)
  apply(@CurrentUser() user: AuthUser, @Body() body: ApplyDriverDto): Promise<DriverProfile> {
    return this.drivers.apply(user.id, body);
  }

  @Get()
  @ZodSerializerDto(DriverProfileDto)
  profile(@CurrentUser() user: AuthUser): Promise<DriverProfile> {
    return this.drivers.profile(user.id);
  }
}
