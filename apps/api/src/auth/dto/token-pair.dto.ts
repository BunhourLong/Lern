import { tokenPairSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class TokenPairDto extends createZodDto(tokenPairSchema) {}
