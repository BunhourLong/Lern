import { meSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class MeDto extends createZodDto(meSchema) {}
