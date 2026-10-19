import { applyDriverSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class ApplyDriverDto extends createZodDto(applyDriverSchema) {}
