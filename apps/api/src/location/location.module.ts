import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { LocationController } from './location.controller';
import { LocationRepository } from './location.repository';
import { LocationService } from './location.service';

@Module({
  imports: [DriversModule],
  controllers: [LocationController],
  providers: [LocationRepository, LocationService],
  exports: [LocationService],
})
export class LocationModule {}
