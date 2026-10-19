import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

@Module({
  imports: [PricingModule],
  controllers: [RidesController],
  providers: [RidesRepository, RidesService],
})
export class RidesModule {}
