import {
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service';
import type { AuthUser } from '../auth/auth.decorators';

type SocketData = { user: AuthUser; expiresAt: number };

// Push channel only (commands stay REST). Auth runs once, in the handshake; rooms: user:{id}.
// Nest builds gateway contexts without the app config, so the global AuthGuard, ZodValidationPipe and
// serializer never run here: every @SubscribeMessage must validate its payload itself.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly tokens: AccessTokenService) {}

  // Middleware rejects before a connection exists; the client gets connect_error "Unauthorized".
  // The token comes from handshake.auth, never the query string, which ends up in access logs.
  afterInit(server: Server): void {
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
}
