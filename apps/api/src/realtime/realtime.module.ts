import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({ imports: [LocationModule], providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
