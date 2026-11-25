import { createRatingSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateRatingDto extends createZodDto(createRatingSchema) {}
