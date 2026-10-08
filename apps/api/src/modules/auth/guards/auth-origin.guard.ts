import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowed = (
      this.config.get<string>('FRONTEND_ORIGINS') ?? 'http://localhost:5173'
    )
      .split(',')
      .map((value) => value.trim());
    // The custom header forces browser preflight; Origin protects cookie requests.
    // Non-browser API clients can send this header without an Origin.
    if (
      request.headers['x-paserve-client'] !== 'web' ||
      (request.headers.origin !== undefined &&
        !allowed.includes(request.headers.origin))
    ) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_ORIGIN',
        message: 'This sign-in request is not allowed.',
      });
    }
    return true;
  }
}
