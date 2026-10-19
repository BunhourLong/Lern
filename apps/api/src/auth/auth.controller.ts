import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { RequestOtpDto } from './dto/request-otp.dto';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly otp: OtpService) {}

  // shortcut: req.ip is the socket peer; set Express `trust proxy` when nginx lands (M8) or every user shares one IP
  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestOtp(@Body() body: RequestOtpDto, @Ip() ip: string): Promise<void> {
    return this.otp.request(body.phone, ip);
  }
}
