import { refreshSessionSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

// Same body shape as refresh: the refresh token is the credential, no user id
export class LogoutDto extends createZodDto(refreshSessionSchema) {}
