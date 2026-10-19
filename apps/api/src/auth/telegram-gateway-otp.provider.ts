import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { OtpProvider } from './otp.provider';

const CODE_TTL_SECONDS = 300;
const TIMEOUT_MS = 5000;

type Envelope<T> = { ok: true; result: T } | { ok: false; error: string };
type RequestStatus = { request_id: string; verification_status?: { status: string } };

// Telegram Gateway (PLAN.md §2.5): Telegram generates, delivers and checks the code; we only keep its
// request_id per phone, for as long as the code lives. $0.01 per delivered code; free to your own number.
export class TelegramGatewayOtpProvider extends OtpProvider {
  private readonly logger = new Logger(TelegramGatewayOtpProvider.name);

  constructor(
    private readonly redis: Redis,
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    super();
  }

  async send(phone: string): Promise<void> {
    const status = await this.call('sendVerificationMessage', {
      phone_number: phone,
      code_length: 6,
      ttl: CODE_TTL_SECONDS,
    });
    if (!status) throw new ServiceUnavailableException('Could not send a code to this number');
    // A resend replaces the request id, so only the newest code verifies
    await this.redis.set(key(phone), status.request_id, 'EX', CODE_TTL_SECONDS);
  }

  async check(phone: string, code: string): Promise<boolean> {
    const requestId = await this.redis.get(key(phone));
    if (!requestId) return false;
    const status = await this.call('checkVerificationStatus', { request_id: requestId, code });
    if (status?.verification_status?.status !== 'code_valid') return false;
    // Single use: of two parallel correct checks, only the one whose DEL removes the key wins
    return (await this.redis.del(key(phone))) === 1;
  }

  // undefined on any failure (network, timeout, ok:false); the error code is logged, never the token
  private async call(method: string, body: object): Promise<RequestStatus | undefined> {
    try {
      const res = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const envelope = (await res.json()) as Envelope<RequestStatus>;
      if (envelope.ok) return envelope.result;
      this.logger.warn(`${method} failed: ${envelope.error}`);
    } catch (err) {
      this.logger.warn(`${method} failed: ${(err as Error).name}`);
    }
    return undefined;
  }
}

const key = (phone: string) => `otp:tg:${phone}`;
