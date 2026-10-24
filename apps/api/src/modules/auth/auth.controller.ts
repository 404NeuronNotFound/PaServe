import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  HttpCode,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimit } from '../../common/rate-limiting/rate-limit.policy.js';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { EmptyDto } from './dto/empty.dto.js';
import {
  UpdateProfileDto,
  ChangeEmailDto,
  ChangePasswordDto,
} from './dto/update-account.dto.js';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from './guards/jwt-auth.guard.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';
import { REFRESH_COOKIE, invalidSession } from './tokens.service.js';

function refreshCookie(request: Request): string | undefined {
  const entry = request.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(REFRESH_COOKIE.length + 1));
  } catch {
    return undefined;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @RateLimit('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  @RateLimit('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto);
    this.setSessionCookie(
      response,
      result.refreshToken,
      result.expiresAt,
      result.keepSignedIn,
    );
    return result.response;
  }

  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  async refresh(
    @Body() _dto: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = refreshCookie(request);
    if (!token) throw invalidSession();
    const result = await this.auth.refresh(token);
    this.setSessionCookie(
      response,
      result.refreshToken,
      result.expiresAt,
      result.keepSignedIn,
    );
    return result.response;
  }

  @RateLimit('logout')
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthOriginGuard)
  async logout(
    @Body() _dto: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(refreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.setHeader('Cache-Control', 'no-store');
  }

  @RateLimit('session')
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { user: request.user };
  }

  private cookieOptions(): CookieOptions {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: production,
      sameSite: production ? 'none' : 'lax',
      path: '/api/v1/auth',
    };
  }

  @Patch('profile')
  @RateLimit('accountUpdate')
  @UseGuards(AuthOriginGuard, JwtAuthGuard)
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.updateProfile(
      request.headers.authorization!.slice(7),
      dto,
    );
  }

  @Post('email')
  @HttpCode(204)
  @RateLimit('accountUpdate')
  @UseGuards(AuthOriginGuard, JwtAuthGuard)
  async changeEmail(
    @Body() dto: ChangeEmailDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changeCredentials(
      request.headers.authorization!.slice(7),
      dto,
    );
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.setHeader('Cache-Control', 'no-store');
  }

  @Post('password')
  @HttpCode(204)
  @RateLimit('accountUpdate')
  @UseGuards(AuthOriginGuard, JwtAuthGuard)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changeCredentials(
      request.headers.authorization!.slice(7),
      dto,
    );
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.setHeader('Cache-Control', 'no-store');
  }

  private setSessionCookie(
    response: Response,
    token: string,
    expiresAt: Date,
    keepSignedIn: boolean,
  ) {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      ...(keepSignedIn ? { expires: expiresAt } : {}),
    });
    response.setHeader('Cache-Control', 'no-store');
  }
}
