import { recordLocationsSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RecordLocationsDto extends createZodDto(recordLocationsSchema) {}
