import { DynamicModule, Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { LocationModule } from '../location/location.module';
import { OutboxModule } from '../outbox/outbox.module';
import { RidesModule } from '../rides/rides.module';
import { ActiveRideController } from './active-ride.controller';
import { EtaProvider } from './eta.provider';
import { MATCHING_CONFIG, type MatchingConfig } from './matching.config';
import { MatchingRepository } from './matching.repository';
import { MatchingService } from './matching.service';
import { MatchingWorker } from './matching.worker';
import { OffersController } from './offers.controller';

@Module({})
export class MatchingModule {
  static forRoot(config: MatchingConfig): DynamicModule {
    return {
      module: MatchingModule,
      imports: [DriversModule, LocationModule, OutboxModule, RidesModule],
      controllers: [ActiveRideController, OffersController],
      providers: [{ provide: MATCHING_CONFIG, useValue: config }, EtaProvider, MatchingRepository, MatchingService, MatchingWorker],
    };
  }
}
