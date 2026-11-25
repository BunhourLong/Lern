import type { StaffSummary } from '@lern/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_ADMIN = 'admin:route';
export const IS_STAFF_PUBLIC = 'admin:public';

export type StaffSessionContext = { sessionId: string; staff: StaffSummary; csrfToken: string };

// Staff routes: StaffAuthGuard (session cookie + CSRF) replaces the app's bearer check, and they 404 while admin is off
export const AdminRoute = () => SetMetadata(IS_ADMIN, true);

// A staff route reachable without a staff session (login)
export const StaffPublic = () => SetMetadata(IS_STAFF_PUBLIC, true);

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ staff: StaffSessionContext }>().staff,
);
