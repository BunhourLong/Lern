import type { PushMessage } from './domain/push-message';

// nowMs is the database's clock (one clock for every instance); ttlMs is how long the message stays worth delivering
export type PushWindow = { nowMs: number; ttlMs: number };
// invalid: tokens FCM will never accept again; retry: send this message again later
export type PushResult = { invalid: string[]; retry: boolean };

// Abstract class rather than interface: Nest injects it by this token
export abstract class PushProvider {
  abstract send(tokens: string[], message: PushMessage, window: PushWindow): Promise<PushResult>;
}
