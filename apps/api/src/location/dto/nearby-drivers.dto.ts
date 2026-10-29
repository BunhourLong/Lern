import { nearbyDriversSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class NearbyDriversDto extends createZodDto(nearbyDriversSchema) {}
