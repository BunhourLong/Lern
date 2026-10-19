import type { Role } from '@lern/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

export type AuthUser = { id: string; roles: Role[] };
export type AccessClaims = { sub: string; roles: Role[] };

export const IS_PUBLIC = 'auth:public';
export const ROLES = 'auth:roles';

// Every route needs a valid access token unless marked public
export const Public = () => SetMetadata(IS_PUBLIC, true);

// The caller needs at least one of these roles
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
