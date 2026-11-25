import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LocationController } from './location.controller';
import { LocationGateway } from './location.gateway';
import { LocationRepository } from './location.repository';
import { LocationService } from './location.service';

@Module({
  imports: [OutboxModule, RealtimeModule],
  controllers: [LocationController],
  providers: [LocationRepository, LocationService, LocationGateway],
  exports: [LocationService],
})
export class LocationModule {}
