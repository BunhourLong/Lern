import type { PushPlatform } from '@lern/contracts';

export type PushNative = {
  platform: PushPlatform;
  requestPermission(): Promise<boolean>;
  getToken(): Promise<string>;
  deleteToken(): Promise<void>;
  onTokenRefresh(cb: (token: string) => void): () => void;
  onMessage(cb: () => void): () => void;
};
export type PushDeps = {
  native: PushNative;
  register: (token: string, platform: PushPlatform) => Promise<unknown>;
  onWake: () => void; // a push arrived while the app is in front: read the snapshot
};

const warn = (err: unknown) =>
  console.warn(`push: ${err instanceof Error ? err.message : String(err)}`);

// This phone's push registration for the signed-in user. A push holds only ids, so the app does nothing with its
// content: it fetches the snapshot. With the app closed the OS draws the notification, and opening the app runs the
// normal reconnect flow. No push is ever required: without permission or a token the app works as before.
export function createPush({ native, register, onWake }: PushDeps) {
  let registered = false;
  let unsubscribe: (() => void)[] | undefined;
  // Bumped by stop: a sync still running then must not register or count for the next user
  let session = 0;
  let stopping: Promise<void> | undefined;

  return {
    // After every socket connect: whatever failed last time gets another try, the rest is a no-op
    async sync(): Promise<void> {
      const started = session;
      await stopping; // otherwise getToken could return the token being deleted
      if (started !== session) return;
      try {
        unsubscribe ??= [
          native.onTokenRefresh(token => {
            register(token, native.platform).catch(err => {
              warn(err);
              if (started === session) registered = false;
            });
          }),
          native.onMessage(onWake),
        ];
        if (registered || !(await native.requestPermission())) return;
        const token = await native.getToken();
        if (started !== session) return;
        await register(token, native.platform);
        if (started === session) registered = true;
      } catch (err) {
        warn(err);
      }
    },
    // shortcut: signing out offline leaves the token registered, so generic pushes can reach this phone until the app
    // next starts online or someone signs in; add a server-side delete if a phone that stays signed out ever matters
    async stop(): Promise<void> {
      session++;
      registered = false;
      unsubscribe?.forEach(stop => stop());
      unsubscribe = undefined;
      stopping = native.deleteToken().catch(warn);
      await stopping;
    },
  };
}
