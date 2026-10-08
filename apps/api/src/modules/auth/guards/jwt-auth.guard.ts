import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RegisteredUser } from '@paserve/contracts';
import { AuthService } from '../auth.service.js';
import { invalidSession } from '../tokens.service.js';

export interface AuthenticatedRequest extends Request {
  user: RegisteredUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw invalidSession();
    request.user = await this.auth.currentUser(match[1]);
    return true;
  }
}
