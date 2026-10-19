import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DevOtpProvider } from './dev-otp.provider';
import { OtpProvider } from './otp.provider';
import { OtpService } from './otp.service';

// OTP_PROVIDER only allows 'dev' so far; switch on it here once a real SMS provider exists
@Module({
  controllers: [AuthController],
  providers: [OtpService, { provide: OtpProvider, useClass: DevOtpProvider }],
})
export class AuthModule {}
