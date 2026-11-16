import { DynamicModule, Module } from '@nestjs/common';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';
import { PricingController } from './pricing.controller';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';
import { RouteProvider } from './route.provider';

@Module({})
export class PricingModule {
  static forRoot(config: PricingConfig): DynamicModule {
    return {
      module: PricingModule,
      // Global, like NotificationsModule: rides reads quotes through PricingService without passing config on
      global: true,
      controllers: [PricingController],
      providers: [{ provide: PRICING_CONFIG, useValue: config }, PricingRepository, PricingService, RouteProvider],
      exports: [PricingService],
    };
  }
}
