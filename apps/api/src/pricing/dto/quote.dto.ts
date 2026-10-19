import { quoteSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class QuoteDto extends createZodDto(quoteSchema) {}
