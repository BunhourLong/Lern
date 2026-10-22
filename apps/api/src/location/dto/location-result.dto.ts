import { locationResultSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class LocationResultDto extends createZodDto(locationResultSchema) {}
