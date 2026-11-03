import { Body, Controller, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { Idempotent } from '../shared/idempotency/idempotency.interceptor';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { NotificationsService } from './notifications.service';

@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  register(@CurrentUser() user: AuthUser, @Body() body: RegisterDeviceDto): Promise<void> {
    return this.notifications.register(user.id, body);
  }
}
