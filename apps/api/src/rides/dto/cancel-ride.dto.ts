import { cancelRideSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class CancelRideDto extends createZodDto(cancelRideSchema) {}
