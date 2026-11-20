import { earningsQuerySchema, earningsSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class EarningsQueryDto extends createZodDto(earningsQuerySchema) {}
export class EarningsDto extends createZodDto(earningsSchema) {}
