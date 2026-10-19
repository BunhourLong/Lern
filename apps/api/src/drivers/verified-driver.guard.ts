import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { type AuthUser, Roles } from '../auth/auth.decorators';
import { DriversService } from './drivers.service';

// Reads the database on every request (unlike roles in the token), so a suspension or ban applies at once
@Injectable()
export class VerifiedDriverGuard implements CanActivate {
  constructor(private readonly drivers: DriversService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    const verification = await this.drivers.verification(user.id);
    if (verification !== 'verified') {
      // The status lets the app show "under review" vs "suspended" instead of a bare 403
      throw new ForbiddenException({ statusCode: 403, message: 'Driver is not verified', verification });
    }
    return true;
  }
}

// Runs after the global AuthGuard, which has already set req.user and checked the driver role
export const VerifiedDriver = () => applyDecorators(Roles('driver'), UseGuards(VerifiedDriverGuard));
