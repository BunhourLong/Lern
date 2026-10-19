import { createQuoteSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateQuoteDto extends createZodDto(createQuoteSchema) {}
