import { Logger } from '@nestjs/common';
import type { PushMessage } from './domain/push-message';
import { PushProvider, type PushResult } from './push.provider';

// Sends nothing. Logs no token: a token is enough to push to that phone.
export class DevPushProvider extends PushProvider {
  private readonly logger = new Logger(DevPushProvider.name);

  send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.logger.log(`push "${message.title}" to ${tokens.length} device(s)`);
    return Promise.resolve({ invalid: [], retry: false });
  }
}
