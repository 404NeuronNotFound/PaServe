import {
  Body,
  Controller,
  Post,
  Get,
  HttpCode,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { EmptyDto } from './dto/empty.dto.js';
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
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthOriginGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto);
    this.setSessionCookie(response, result.refreshToken, result.expiresAt);
    return result.response;
  }

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
    this.setSessionCookie(response, result.refreshToken, result.expiresAt);
    return result.response;
  }

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

  private setSessionCookie(response: Response, token: string, expiresAt: Date) {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
  }
}
