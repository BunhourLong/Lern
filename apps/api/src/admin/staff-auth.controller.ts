import { type StaffLoginResponse, staffLoginResponseSchema, type StaffMeResponse } from '@lern/contracts';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Ip, Post, Res, UnsupportedMediaTypeException } from '@nestjs/common';
import type { ServerResponse as Response } from 'node:http';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminRoute, CurrentStaff, StaffPublic, type StaffSessionContext } from './admin.decorators';
import { formatClearStaffCookie, formatStaffCookie } from './domain/cookie';
import { StaffLoginDto, StaffMeResponseDto } from './dto/staff-auth.dto';
import { StaffAuthService } from './staff-auth.service';

export const ADMIN_COOKIE_SECURE = 'admin:cookie-secure';

// Every answer here carries a credential or a CSRF token: never cached
@AdminRoute()
@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    @Inject(ADMIN_COOKIE_SECURE) private readonly secure: boolean,
  ) {}

  // shortcut: req.ip is the socket peer; set Express `trust proxy` when nginx lands (M8) or all staff share one IP window
  @Post('login')
  @StaffPublic()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(staffLoginResponseSchema)
  async login(
    @Body() body: StaffLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffLoginResponse> {
    res.setHeader('Cache-Control', 'no-store');
    // Login CSRF: a cross-site <form> can post form or text bodies but not JSON without a CORS preflight
    if ((contentType ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Content-Type must be application/json');
    }
    const result = await this.auth.login(body, ip, userAgent);
    if (result.status === 'mfa_required') return result;
    res.setHeader('Set-Cookie', formatStaffCookie(result.rawToken, this.secure));
    return { status: 'authenticated', staff: result.staff, csrfToken: result.csrfToken };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(StaffMeResponseDto)
  me(@CurrentStaff() session: StaffSessionContext, @Res({ passthrough: true }) res: Response): StaffMeResponse {
    res.setHeader('Cache-Control', 'no-store');
    return { staff: session.staff, csrfToken: session.csrfToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentStaff() session: StaffSessionContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(session.sessionId);
    this.clearCookie(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentStaff() session: StaffSessionContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(session.staff.id);
    this.clearCookie(res);
  }

  private clearCookie(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', formatClearStaffCookie(this.secure));
  }
}
