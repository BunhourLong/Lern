import { receiptSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReceiptDto extends createZodDto(receiptSchema) {}
