import { availabilitySchema, setAvailabilitySchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class SetAvailabilityDto extends createZodDto(setAvailabilitySchema) {}
export class AvailabilityDto extends createZodDto(availabilitySchema) {}
