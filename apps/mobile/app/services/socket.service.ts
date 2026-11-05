import {
  DRIVER_CONNECTIVITY_EVENT,
  DRIVER_LOCATION_EVENT,
  DRIVER_POSITION_EVENT,
  type DriverConnectivity,
  driverConnectivitySchema,
  type DriverPosition,
  driverPositionSchema,
  type LocationPoint,
  locationResultSchema,
  OFFER_UPDATED_EVENT,
  type Offer,
  offerSchema,
  RIDE_UPDATED_EVENT,
  type Ride,
  rideSchema,
} from '@lern/contracts';
import type { io as ioClient } from 'socket.io-client';
import type { Refreshed } from './api.service';

export type SocketHandlers = {
  onConnect(): void; // the caller fetches the REST snapshot then: nothing missed while away is replayed
  onRide(ride: Ride): void;
  onOffer(offer: Offer): void;
  onPosition(position: DriverPosition): void;
  onConnectivity(connectivity: DriverConnectivity): void;
  onRejected(event: string, raw: unknown): void; // a payload the contract refused
  onRaw(event: string, payload?: unknown): void; // everything seen, before validation (debug log)
};
export type SocketDeps = {
  url: string;
  io: typeof ioClient;
  token: () => string | undefined;
  refresh: () => Promise<Refreshed>;
  handlers: SocketHandlers;
  sleep?: (ms: number) => Promise<void>;
};
export type RealtimeSocket = ReturnType<typeof connectSocket>;

const ACK_MS = 5000;
const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// Server push (PLAN.md §2.1): ordering is the stores' job, this only checks every payload against the contract,
// since outbox payloads are built in SQL and nothing else checks them on the way out.
export function connectSocket({
  url,
  io,
  token,
  refresh,
  handlers,
  sleep = wait,
}: SocketDeps) {
  // websocket only: polling needs sticky sessions (PLAN-notes M3). auth as a callback: each reconnect sends the
  // access token current at that moment
  const socket = io(url, {
    transports: ['websocket'],
    auth: cb => cb({ token: token() }),
  });

  socket.onAny((event: string, payload: unknown) =>
    handlers.onRaw(event, payload),
  );
  const on = <T>(
    event: string,
    schema: {
      safeParse(v: unknown): { success: true; data: T } | { success: false };
    },
    handle: (v: T) => void,
  ) =>
    socket.on(event, (raw: unknown) => {
      const parsed = schema.safeParse(raw);
      if (parsed.success) handle(parsed.data);
      else handlers.onRejected(event, raw);
    });
  on(RIDE_UPDATED_EVENT, rideSchema, handlers.onRide);
  on(OFFER_UPDATED_EVENT, offerSchema, handlers.onOffer);
  on(DRIVER_POSITION_EVENT, driverPositionSchema, handlers.onPosition);
  on(
    DRIVER_CONNECTIVITY_EVENT,
    driverConnectivitySchema,
    handlers.onConnectivity,
  );
  let closed = false;
  // One re-auth per connection attempt: a server that refuses a freshly refreshed token must not make this loop
  let reauthed = false;
  socket.on('connect', () => {
    reauthed = false;
    handlers.onRaw('connect');
    handlers.onConnect();
  });

  // socket.io retries network failures by itself, but not a handshake the server refused nor a disconnect the
  // server made (it drops a socket when its token expires): refresh the session, then connect again. While the
  // refresh is only offline, keep trying with backoff; refused or none = signed out, stop.
  const reauth = async () => {
    if (reauthed) return;
    reauthed = true;
    for (let delay = 1000; !closed; delay = Math.min(delay * 2, 60_000)) {
      const refreshed = await refresh();
      if (refreshed === 'ok' && !closed) socket.connect();
      if (refreshed !== 'offline') return;
      await sleep(delay);
    }
  };
  socket.on('connect_error', (err: Error) => {
    handlers.onRaw('connect_error', err.message);
    if (err.message === 'Unauthorized') reauth();
  });
  socket.on('disconnect', (reason: string) => {
    handlers.onRaw('disconnect', reason);
    if (reason === 'io server disconnect') reauth();
  });

  return {
    // Foreground driver position; false = not delivered (down, refused, no ack in time), so the caller queues it
    async sendLocation(point: LocationPoint): Promise<boolean> {
      if (!socket.connected) return false;
      try {
        return locationResultSchema.safeParse(
          await socket
            .timeout(ACK_MS)
            .emitWithAck(DRIVER_LOCATION_EVENT, point),
        ).success;
      } catch {
        return false;
      }
    },
    close: () => {
      closed = true;
      socket.disconnect();
    },
  };
}
