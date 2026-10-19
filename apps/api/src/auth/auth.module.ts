import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { DevOtpProvider } from './dev-otp.provider';
import { OtpProvider } from './otp.provider';
import { OtpService } from './otp.service';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';

// OTP_PROVIDER only allows 'dev' so far; switch on it here once a real SMS provider exists
@Module({})
export class AuthModule {
  static forRoot(jwtSecret: string): DynamicModule {
    return {
      module: AuthModule,
      imports: [
        UsersModule,
        // Pinned algorithm: verify() then rejects tokens signed any other way (e.g. alg "none")
        JwtModule.register({
          secret: jwtSecret,
          signOptions: { algorithm: 'HS256', expiresIn: '15m' },
          verifyOptions: { algorithms: ['HS256'] },
        }),
      ],
      controllers: [AuthController],
      providers: [
        OtpService,
        SessionsRepository,
        SessionsService,
        { provide: OtpProvider, useClass: DevOtpProvider },
        // Global guard lives here because it needs this module's JwtService
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
