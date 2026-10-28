import { DRIVER_LOCATION_EVENT, type LocationResult, locationPointSchema, type SocketError } from '@lern/contracts';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { SocketData } from '../realtime/realtime.gateway';
import { LocationService } from './location.service';

// Shares RealtimeGateway's server (same port and options): auth already ran in its handshake middleware.
// No global pipe here, so the payload is Zod-parsed in the handler.
@WebSocketGateway({ transports: ['websocket'] })
export class LocationGateway {
  constructor(private readonly location: LocationService) {}

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
