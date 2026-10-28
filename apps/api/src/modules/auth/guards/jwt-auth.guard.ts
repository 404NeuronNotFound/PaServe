import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUser } from '@paserve/contracts';
import { AuthService } from '../auth.service.js';
import { invalidSession } from '../tokens.service.js';
import { trackRequestWork } from '../../../common/load-shedding/request-work.js';

export interface AuthenticatedRequest extends Request {
  user: CurrentUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw invalidSession();
    request.user = await trackRequestWork(request, () =>
      this.auth.currentUser(match[1]),
    );
    return true;
  }
}
