import { requestOtpSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class RequestOtpDto extends createZodDto(requestOtpSchema) {}
