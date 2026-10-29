import { offerSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class OfferDto extends createZodDto(offerSchema) {}
