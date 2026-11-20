import { rideHistoryQuerySchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RideHistoryQueryDto extends createZodDto(rideHistoryQuerySchema) {}
