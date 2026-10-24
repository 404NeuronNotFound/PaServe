import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'node:crypto';
import { SESSION_LIMITS } from '@paserve/contracts';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_SECONDS = SESSION_LIMITS.personalSeconds;
export const REFRESH_COOKIE = 'paserve_refresh';
export const invalidSession = () =>
  new UnauthorizedException({
    code: 'INVALID_SESSION',
    message: 'Your session has ended. Please sign in again.',
  });

interface Claims {
  sub: string;
  sid: string;
  type: 'access' | 'refresh';
  keepSignedIn?: boolean;
}

@Injectable()
export class TokensService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
    this.refreshSecret = config.get<string>('JWT_REFRESH_SECRET') ?? '';
    if (
      this.accessSecret.length < 32 ||
      this.refreshSecret.length < 32 ||
      this.accessSecret === this.refreshSecret
    ) {
      throw new Error(
        'Configure distinct JWT_ACCESS_SECRET and JWT_REFRESH_SECRET of at least 32 characters.',
      );
    }
  }

  async issue(
    userId: string,
    sessionId: string,
    expiresAt: Date,
    keepSignedIn = true,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const sessionExpiry = Math.floor(expiresAt.getTime() / 1000);
    const expiresIn = Math.min(ACCESS_TOKEN_SECONDS, sessionExpiry - now);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw invalidSession();
    const payload = { sub: userId, sid: sessionId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...payload, type: 'access', exp: now + expiresIn },
        {
          secret: this.accessSecret,
          algorithm: 'HS256',
          issuer: 'paserve-api',
          audience: 'paserve:web',
          jwtid: randomUUID(),
        },
      ),
      this.jwt.signAsync(
        {
          ...payload,
          type: 'refresh',
          keepSignedIn,
          exp: sessionExpiry,
        },
        {
          secret: this.refreshSecret,
          algorithm: 'HS256',
          issuer: 'paserve-api',
          audience: 'paserve:refresh',
          jwtid: randomUUID(),
        },
      ),
    ]);
    return { accessToken, refreshToken, expiresIn };
  }

  async verify(token: string, type: 'access' | 'refresh'): Promise<Claims> {
    try {
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: type === 'access' ? this.accessSecret : this.refreshSecret,
          algorithms: ['HS256'],
          issuer: 'paserve-api',
          audience: type === 'access' ? 'paserve:web' : 'paserve:refresh',
        },
      );
      if (
        claims.type !== type ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        typeof claims.exp !== 'number'
      )
        throw invalidSession();
      if (
        claims.keepSignedIn !== undefined &&
        typeof claims.keepSignedIn !== 'boolean'
      )
        throw invalidSession();
      return {
        sub: claims.sub,
        sid: claims.sid,
        type,
        ...(typeof claims.keepSignedIn === 'boolean'
          ? { keepSignedIn: claims.keepSignedIn }
          : {}),
      };
    } catch {
      throw invalidSession();
    }
  }

  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
