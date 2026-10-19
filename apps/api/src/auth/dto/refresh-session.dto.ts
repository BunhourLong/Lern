import { refreshSessionSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RefreshSessionDto extends createZodDto(refreshSessionSchema) {}
