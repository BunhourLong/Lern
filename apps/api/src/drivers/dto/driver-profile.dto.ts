import { driverProfileSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class DriverProfileDto extends createZodDto(driverProfileSchema) {}
