import {
  offerSchema,
  rideSchema,
  type PushData,
  type PushLocale,
  type PushPlatform,
} from '@lern/contracts';

export type PushNative = {
  platform: PushPlatform;
  locale(): PushLocale;
  requestPermission(): Promise<boolean>;
  getToken(): Promise<string>;
  deleteToken(): Promise<void>;
  onTokenRefresh(cb: (token: string) => void): () => void;
  onMessage(cb: () => void): () => void;
  onNotificationOpenedApp(cb: (data: unknown) => void): () => void;
  getInitialNotification(): Promise<unknown>; // null when the app was opened normally
};
export type PushDeps = {
  native: PushNative;
  register: (
    token: string,
    platform: PushPlatform,
    locale: PushLocale,
  ) => Promise<unknown>;
  onWake: () => void;
  onOpen: (data: PushData | undefined) => void;
};

function parseTap(data: unknown): PushData | undefined {
  if (!data || typeof data !== 'object') return;
  const { type, rideId, offerId, seq } = data as Record<string, unknown>;
  const ride = rideSchema.shape.id.safeParse(rideId);
  if (!ride.success) return;
  if (type === 'offer') {
    const offer = offerSchema.shape.id.safeParse(offerId);
    if (offer.success)
      return { type, rideId: ride.data, offerId: offer.data };
  }
  if (
    type === 'ride' &&
    typeof seq === 'string' &&
    /^[1-9]\d*$/.test(seq) &&
    Number.isSafeInteger(Number(seq))
  )
    return { type, rideId: ride.data, seq };
}

const warn = (err: unknown) =>
  console.warn(`push: ${err instanceof Error ? err.message : String(err)}`);

// Tap delivery starts at boot. Device registration and foreground refresh belong to the socket session.
export function createPush({ native, register, onWake, onOpen }: PushDeps) {
  let registered = false;
  let unsubscribeRefresh: (() => void) | undefined;
  let unsubscribeMessage: (() => void) | undefined;
  let unsubscribeOpen: (() => void) | undefined;
  // Firebase hands out the launch notification once. Keep its read across listener remounts.
  // undefined = unread, null = consumed, superseded by a warm tap, or signed out.
  let initial: Promise<unknown> | null | undefined;
  let listeningForPush = true;
  let session = 0;
  let stopping: Promise<void> | undefined;

  function stopRegistration() {
    session++;
    registered = false;
    unsubscribeRefresh?.();
    unsubscribeMessage?.();
    unsubscribeRefresh = undefined;
    unsubscribeMessage = undefined;
  }

  return {
    listenForOpens(): void {
      listeningForPush = true;
      if (unsubscribeOpen) return;
      try {
        let listening = true;
        const unsubscribe = native.onNotificationOpenedApp(data => {
          if (!listening) return;
          initial = null;
          onOpen(parseTap(data));
        });
        unsubscribeOpen = () => {
          listening = false;
          unsubscribe();
        };
        if (initial === null) return;
        const launch = (initial ??= native.getInitialNotification().catch(err => {
          warn(err);
          return null;
        }));
        launch.then(data => {
          if (!listening || initial !== launch) return;
          initial = null;
          if (data !== null) onOpen(parseTap(data));
        });
      } catch (err) {
        warn(err);
      }
    },
    removeListeners(): void {
      listeningForPush = false;
      unsubscribeOpen?.();
      unsubscribeOpen = undefined;
      stopRegistration();
    },
    // After every socket connect: whatever failed last time gets another try, the rest is a no-op
    async sync(): Promise<void> {
      const started = session;
      await stopping; // otherwise getToken could return the token being deleted
      if (!listeningForPush || started !== session) return;
      try {
        unsubscribeRefresh ??= native.onTokenRefresh(token => {
          if (started !== session) return;
          register(token, native.platform, native.locale()).catch(err => {
            warn(err);
            if (started === session) registered = false;
          });
        });
        unsubscribeMessage ??= native.onMessage(() => {
          if (started === session) onWake();
        });
        if (registered || !(await native.requestPermission())) return;
        const token = await native.getToken();
        if (started !== session) return;
        await register(token, native.platform, native.locale());
        if (started === session) registered = true;
      } catch (err) {
        warn(err);
      }
    },
    // shortcut: signing out offline leaves the token registered, so generic pushes can reach this phone until the app
    // next starts online or someone signs in; add a server-side delete if a phone that stays signed out ever matters
    async stop(): Promise<void> {
      initial = null;
      stopRegistration();
      stopping = native.deleteToken().catch(warn);
      await stopping;
    },
  };
}
