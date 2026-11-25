import { DynamicModule, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DRIVERS_CONFIG, type DriversConfig } from './drivers.config';
import { DriversController } from './drivers.controller';
import { DriversRepository } from './drivers.repository';
import { DriversService } from './drivers.service';

@Module({})
export class DriversModule {
  static forRoot(config: DriversConfig): DynamicModule {
    return {
      module: DriversModule,
      // Global, like PricingModule: rides, matching, location and @VerifiedDriver() use DriversService without
      // passing config on
      global: true,
      imports: [UsersModule],
      controllers: [DriversController],
      providers: [{ provide: DRIVERS_CONFIG, useValue: config }, DriversRepository, DriversService],
      exports: [DriversService],
    };
  }
}
