import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

@Module({
  imports: [RealtimeModule],
  providers: [OutboxRepository, OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
