import { activeRidesSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class ActiveRidesDto extends createZodDto(activeRidesSchema) {}
