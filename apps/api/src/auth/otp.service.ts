import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { consume } from '../shared/redis/rate-limit';
import { OtpProvider } from './otp.provider';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

function throttled(retryAfter: number): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many OTP attempts', retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Injectable()
export class OtpService {
  constructor(
    private readonly provider: OtpProvider,
    private readonly redis: Redis,
  ) {}

  // Each window is checked only after the previous passed, so a blocked request doesn't use up later ones
  async request(phone: string, ip: string): Promise<void> {
    const limits: [key: string, limit: number, windowSeconds: number][] = [
      // High on purpose: carrier-grade NAT puts many Cambodian mobile users behind one IP
      [`rl:otp:ip:${ip}`, 100, HOUR],
      [`rl:otp:resend:${phone}`, 1, MINUTE],
      // SMS costs money: caps pumping one number even when the attacker rotates IPs
      [`rl:otp:phone:${phone}`, 5, HOUR],
    ];
    for (const [key, limit, window] of limits) {
      const retryAfter = await consume(this.redis, key, limit, window);
      if (retryAfter) throw throttled(retryAfter);
    }
    await this.provider.send(phone);
  }

  // The attempt is counted before the check, so parallel guesses can't outrun the limit
  async verify(phone: string, code: string): Promise<boolean> {
    const key = `rl:otp:verify:${phone}`;
    const retryAfter = await consume(this.redis, key, 5, 15 * MINUTE);
    if (retryAfter) throw throttled(retryAfter);
    const ok = await this.provider.check(phone, code);
    if (ok) await this.redis.del(key);
    return ok;
  }
}
