import { registerDeviceSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}
