import { Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from './otp.provider';

const DEV_CODE = '000000';

// Dev/test only (OTP_PROVIDER=dev): sends nothing and accepts one fixed code for every phone
@Injectable()
export class DevOtpProvider extends OtpProvider {
  private readonly logger = new Logger(DevOtpProvider.name);

  send(phone: string): Promise<void> {
    this.logger.log(`OTP for ${phone} is ${DEV_CODE}`);
    return Promise.resolve();
  }

  check(_phone: string, code: string): Promise<boolean> {
    return Promise.resolve(code === DEV_CODE);
  }
}
