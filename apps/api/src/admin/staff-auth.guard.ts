import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { IS_ADMIN, IS_STAFF_PUBLIC, type StaffSessionContext } from './admin.decorators';
import { parseStaffCookie } from './domain/cookie';
import { StaffAuthRepository } from './staff-auth.repository';
import { hashSessionToken } from './staff-auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameToken(header: string | string[] | undefined, expected: string): boolean {
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Registered globally (APP_GUARD) by AdminModule: @AdminRoute() routes need a live staff session cookie, and
// mutating ones also the session's CSRF token in X-CSRF-Token (SameSite=Lax alone still lets top-level POSTs through)
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly repo: StaffAuthRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_STAFF_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<IncomingMessage & { staff?: StaffSessionContext }>();
    const rawToken = parseStaffCookie(req.headers.cookie);
    if (!rawToken) throw new UnauthorizedException();
    const session = await this.repo.validateAndSlideSession(hashSessionToken(rawToken));
    if (!session) throw new UnauthorizedException();
    if (!SAFE_METHODS.has(req.method ?? '') && !sameToken(req.headers['x-csrf-token'], session.csrfToken)) {
      throw new ForbiddenException();
    }
    req.staff = session;
    return true;
  }
}
