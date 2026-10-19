import type { TokenPair } from '@lern/contracts';
import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { Public } from './auth.decorators';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
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

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(TokenPairDto)
  verifyOtp(@Body() body: VerifyOtpDto): Promise<TokenPair> {
    return this.sessions.start(body.phone, body.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(TokenPairDto)
  refresh(@Body() body: RefreshSessionDto): Promise<TokenPair> {
    return this.sessions.refresh(body.refreshToken);
  }
}
