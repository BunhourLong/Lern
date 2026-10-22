import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PricingModule } from '../pricing/pricing.module';
import { ActiveRideController } from './active-ride.controller';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

@Module({
  imports: [DriversModule, OutboxModule, PricingModule],
  controllers: [RidesController, ActiveRideController],
  providers: [RidesRepository, RidesService],
})
export class RidesModule {}
