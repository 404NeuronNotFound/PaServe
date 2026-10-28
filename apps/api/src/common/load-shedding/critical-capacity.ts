import { Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export const CRITICAL_CAPACITY = Symbol('paserve:critical-capacity');
export const READINESS_CAPACITY = Symbol('paserve:readiness-capacity');
/** Explicit finite staff routes only. Does not replace live authorization. */
export const CriticalCapacity = () => SetMetadata(CRITICAL_CAPACITY, true);
export const CapacityReadiness = () => SetMetadata(READINESS_CAPACITY, true);

@Injectable()
export class CriticalAccessService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  eligible(authorization: string | undefined): boolean {
    const match = /^Bearer (\S+)$/i.exec(authorization ?? '');
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!match || match[1].length > 4096 || !secret || secret.length < 32)
      return false;
    try {
      // Cheap synchronous HS256 check: no DB call, provider request or async waiter.
      const claims = this.jwt.verify<Record<string, unknown>>(match[1], {
        secret,
        algorithms: ['HS256'],
        issuer: 'paserve-api',
        audience: 'paserve:web',
      });
      return (
        claims.type === 'access' &&
        typeof claims.sub === 'string' &&
        typeof claims.sid === 'string' &&
        typeof claims.exp === 'number' &&
        (claims.keepSignedIn === undefined ||
          typeof claims.keepSignedIn === 'boolean')
      );
    } catch {
      return false;
    }
  }
}
