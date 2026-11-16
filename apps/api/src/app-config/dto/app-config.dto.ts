import { appConfigSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class AppConfigDto extends createZodDto(appConfigSchema) {}
