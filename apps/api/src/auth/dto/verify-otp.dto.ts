import { verifyOtpSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class VerifyOtpDto extends createZodDto(verifyOtpSchema) {}
