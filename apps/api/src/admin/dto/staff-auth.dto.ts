import { staffLoginSchema, staffMeResponseSchema, staffMfaCallbackSchema } from '@lern/contracts';
import { createZodDto } from 'nestjs-zod';

export class StaffLoginDto extends createZodDto(staffLoginSchema) {}

export class StaffMfaCallbackDto extends createZodDto(staffMfaCallbackSchema) {}

// The login response is a union, which a DTO class can't extend: the controller serializes it with the schema itself
export class StaffMeResponseDto extends createZodDto(staffMeResponseSchema) {}
