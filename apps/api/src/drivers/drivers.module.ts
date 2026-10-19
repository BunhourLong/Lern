import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DriversController } from './drivers.controller';
import { DriversRepository } from './drivers.repository';
import { DriversService } from './drivers.service';

// Modules using @VerifiedDriver() import this one; Nest builds the guard there from the exported DriversService
@Module({
  imports: [UsersModule],
  controllers: [DriversController],
  providers: [DriversRepository, DriversService],
  exports: [DriversService],
})
export class DriversModule {}
