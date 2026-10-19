import { rideSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RideDto extends createZodDto(rideSchema) {}
