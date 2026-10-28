import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { defer, lastValueFrom } from 'rxjs';
import { trackRequestWork } from './request-work.js';

@Injectable()
export class ApiWorkInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    // The inner subscription runs to completion even if the HTTP client leaves.
    // Current routes return finite handler results; SSE uses manual Express responses.
    return defer(() =>
      trackRequestWork(request, () => lastValueFrom(next.handle())),
    );
  }
}
