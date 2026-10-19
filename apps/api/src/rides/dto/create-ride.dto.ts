import { createRideSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateRideDto extends createZodDto(createRideSchema) {}
