import { nearbyDriversQuerySchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class NearbyDriversQueryDto extends createZodDto(nearbyDriversQuerySchema) {}
