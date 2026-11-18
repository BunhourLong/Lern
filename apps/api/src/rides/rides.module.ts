import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { RidesController } from './rides.controller';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

@Module({
  imports: [OutboxModule],
  controllers: [RidesController],
  providers: [RidesRepository, RidesService],
  exports: [RidesService],
})
export class RidesModule {}
