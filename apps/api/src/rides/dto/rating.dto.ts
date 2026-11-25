import { ratingSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RatingDto extends createZodDto(ratingSchema) {}
