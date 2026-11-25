import type { Role } from '@lern/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { IS_ADMIN } from '../admin/admin.decorators';
import { AccessTokenService } from './access-token.service';
import { type AuthUser, IS_PUBLIC, ROLES } from './auth.decorators';

const BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/;

export const ADMIN_ENABLED = 'auth:admin-enabled';

// Registered globally (APP_GUARD): deny by default, @Public() opts out, @Roles() narrows. Staff (@AdminRoute) routes
// are StaffAuthGuard's: a Bearer token never opens them, and while admin is off they 404 even if one got mounted.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly reflector: Reflector,
    @Inject(ADMIN_ENABLED) private readonly adminEnabled: boolean,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets)) {
      if (!this.adminEnabled) throw new NotFoundException();
      return true;
    }
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
