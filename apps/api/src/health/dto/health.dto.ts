import { healthSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class HealthDto extends createZodDto(healthSchema) {}
