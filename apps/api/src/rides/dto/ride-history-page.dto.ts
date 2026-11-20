import { rideHistoryPageSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RideHistoryPageDto extends createZodDto(rideHistoryPageSchema) {}
