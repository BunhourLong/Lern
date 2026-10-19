import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessClaims, AuthUser } from './auth.decorators';

// The one place that knows the access-token format; HTTP (AuthGuard) and sockets (handshake) both verify here
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: AuthUser): Promise<string> {
    const claims: AccessClaims = { sub: user.id, roles: user.roles };
    return this.jwt.signAsync(claims);
  }

  // Rejects a malformed, forged, expired or non-HS256 token
  async verify(token: string): Promise<{ user: AuthUser; expiresAt: number }> {
    const claims = await this.jwt.verifyAsync<AccessClaims & { exp: number }>(token);
    // Tokens issued before roles were added carry none; treat as no roles rather than crash
    return { user: { id: claims.sub, roles: claims.roles ?? [] }, expiresAt: claims.exp * 1000 };
  }
}
