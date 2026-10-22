import {
  DRIVER_LOCATION_EVENT,
  type LocationResult,
  locationPointSchema,
  type SocketError,
} from '@lern/contracts';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service';
import type { AuthUser } from '../auth/auth.decorators';
import { LocationService } from '../location/location.service';

type SocketData = { user: AuthUser; expiresAt: number };

// Push channel only (commands stay REST). Auth runs once, in the handshake; rooms: user:{id} (ride events go
// to the participants' user rooms, so there are no ride rooms to leave). WebSocket only: long-polling would
// need sticky sessions across instances. The Redis adapter fans room emits out to every instance.
// Nest builds gateway contexts without the app config, so the global AuthGuard, ZodValidationPipe and
// serializer never run here: every @SubscribeMessage must validate its payload itself.
@WebSocketGateway({ transports: ['websocket'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  @WebSocketServer() server!: Server;
  // Own connections: the subscriber one can't run other commands
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(
    private readonly tokens: AccessTokenService,
    private readonly location: LocationService,
    redis: Redis,
  ) {
    // pub keeps the default retry limit: emits during an outage are dropped after 20 tries instead of
    // queueing without bound (clients recover through seq + REST snapshot). sub has none: a SUBSCRIBE dropped
    // that way is never re-sent, and this instance would silently stop receiving other instances' emits.
    this.pub = redis.duplicate();
    this.sub = redis.duplicate({ maxRetriesPerRequest: null });
    const logger = new Logger('RealtimeRedis');
    for (const c of [this.pub, this.sub]) {
      // duplicate() copies options, not listeners; /health reports the outage
      c.on('error', (err: Error) => logger.warn(err.message));
      // The adapter fires (un)subscribe and publish without awaiting them. When the connection closes, those
      // queued commands reject; this handler stops that from being an unhandled rejection that kills the
      // process. Callers that do await a command still get its rejection.
      const send = c.sendCommand.bind(c);
      c.sendCommand = (...args: Parameters<Redis['sendCommand']>) => {
        args[0].promise.catch(() => undefined);
        return send(...args);
      };
    }
  }

  // Middleware rejects before a connection exists; the client gets connect_error "Unauthorized".
  // The token comes from handshake.auth, never the query string, which ends up in access logs.
  afterInit(server: Server): void {
    server.adapter(createAdapter(this.pub, this.sub));
    server.use((socket, next) => {
      const { token } = socket.handshake.auth as { token?: unknown };
      this.tokens
        .verify(typeof token === 'string' ? token : '')
        .then(({ user, expiresAt }) => {
          Object.assign(socket.data as SocketData, { user, expiresAt });
          next();
        })
        .catch(() => next(new Error('Unauthorized')));
    });
  }

  // False while this instance can't publish to Redis: an emit would reach only its own sockets
  canFanOut(): boolean {
    return this.pub.status === 'ready';
  }

  onApplicationShutdown(): void {
    this.pub.disconnect();
    this.sub.disconnect();
  }

  handleConnection(socket: Socket): void {
    const { user, expiresAt } = socket.data as SocketData;
    void socket.join(`user:${user.id}`);
    // A socket must not outlive its token (bans, role changes); the client reconnects with a fresh one.
    // Per-connection timer, not a business timer: it dies with the socket.
    const timer = setTimeout(() => socket.disconnect(true), expiresAt - Date.now());
    socket.once('disconnect', () => clearTimeout(timer));
  }

  @SubscribeMessage('whoami')
  whoami(socket: Socket): AuthUser {
    return (socket.data as SocketData).user;
  }

  // Foreground path: one point per message, the ack is the result. The driver id is always the token's.
  // shortcut: no per-socket rate limit, a client can flood; add one before the M8 load test.
  @SubscribeMessage(DRIVER_LOCATION_EVENT)
  async recordLocation(socket: Socket, payload: unknown): Promise<LocationResult | SocketError> {
    const { user } = socket.data as SocketData;
    if (!user.roles.includes('driver')) return { error: 'FORBIDDEN' }; // skip the DB call for riders
    const point = locationPointSchema.safeParse(payload);
    if (!point.success) return { error: 'BAD_REQUEST' };
    const result = await this.location.record(user.id, [point.data]);
    return result ?? { error: 'FORBIDDEN' };
  }
}
