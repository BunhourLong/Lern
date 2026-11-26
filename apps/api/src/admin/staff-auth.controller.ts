import { type StaffLoginResponse, staffLoginResponseSchema, type StaffMeResponse } from '@lern/contracts';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Ip, Post, Res, UnsupportedMediaTypeException } from '@nestjs/common';
import type { ServerResponse as Response } from 'node:http';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminRoute, CurrentStaff, StaffPublic, type StaffSessionContext } from './admin.decorators';
import { formatClearStaffCookie, formatClearStaffMfaCookie, formatStaffCookie, formatStaffMfaCookie } from './domain/cookie';
import { StaffLoginDto, StaffMeResponseDto, StaffMfaCallbackDto } from './dto/staff-auth.dto';
import { ADMIN_COOKIE_SECURE, StaffAuthService } from './staff-auth.service';

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
    requireJson(res, contentType);
    const result = await this.auth.login(body, ip, userAgent);
    if (result.status === 'mfa_required') {
      // The binding token travels only in its HttpOnly cookie, never in the body
      res.setHeader('Set-Cookie', formatStaffMfaCookie(result.mfaBindingToken, this.secure));
      return { status: 'mfa_required', redirectUrl: result.redirectUrl };
    }
    res.setHeader('Set-Cookie', formatStaffCookie(result.rawToken, this.secure));
    return { status: 'authenticated', staff: result.staff, csrfToken: result.csrfToken };
  }

  // Duo sends the browser back to the admin page, which posts the state and code here with the binding cookie
  @Post('mfa/callback')
  @StaffPublic()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(StaffMeResponseDto)
  async mfaCallback(
    @Body() body: StaffMfaCallbackDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffMeResponse> {
    requireJson(res, contentType);
    let consumed = false;
    try {
      const result = await this.auth.completeMfa(body, cookie, ip, userAgent, () => (consumed = true));
      res.setHeader('Set-Cookie', [formatStaffCookie(result.rawToken, this.secure), formatClearStaffMfaCookie(this.secure)]);
      return { staff: result.staff, csrfToken: result.csrfToken };
    } catch (err) {
      // The pending login is gone: its cookie is dead weight
      if (consumed) res.setHeader('Set-Cookie', formatClearStaffMfaCookie(this.secure));
      throw err;
    }
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

// Login CSRF: a cross-site <form> can post form or text bodies but not JSON without a CORS preflight
function requireJson(res: Response, contentType: string | undefined): void {
  res.setHeader('Cache-Control', 'no-store');
  if ((contentType ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new UnsupportedMediaTypeException('Content-Type must be application/json');
  }
}
