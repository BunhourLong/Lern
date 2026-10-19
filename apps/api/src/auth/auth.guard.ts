import type { Role } from '@lern/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { AccessTokenService } from './access-token.service';
import { type AuthUser, IS_PUBLIC, ROLES } from './auth.decorators';

const BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/;

// Registered globally (APP_GUARD): deny by default, @Public() opts out, @Roles() narrows
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<IncomingMessage & { user?: AuthUser }>();
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    const { user } = await this.tokens.verify(token).catch(() => {
      throw new UnauthorizedException();
    });
    req.user = user;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (required && !required.some((role) => user.roles.includes(role))) throw new ForbiddenException();
    return true;
  }
}
