import type { TokenPair } from '@lern/contracts';
import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { Public } from './auth.decorators';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
  ) {}

  // shortcut: req.ip is the socket peer; set Express `trust proxy` when nginx lands (M8) or every user shares one IP
  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestOtp(@Body() body: RequestOtpDto, @Ip() ip: string): Promise<void> {
    return this.otp.sendCode(body.phone, ip);
  }

  // Not @Idempotent: phone + 6-digit code is guessable, so a database reader could brute-force the stored
  // pair. A lost response costs the user a new code instead.
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(TokenPairDto)
  verifyOtp(@Body() body: VerifyOtpDto): Promise<TokenPair> {
    return this.sessions.start(body.phone, body.code);
  }

  // Replays the rotated pair if the response was lost: a retry would otherwise look like token theft
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ZodSerializerDto(TokenPairDto)
  refresh(@Body() body: RefreshSessionDto): Promise<TokenPair> {
    return this.sessions.refresh(body.refreshToken);
  }
}
