import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { defer, lastValueFrom, tap } from 'rxjs';
import {
  REQUEST_WORK,
  trackRequestWork,
  type AdmittedRequest,
} from './request-work.js';

@Injectable()
export class ApiWorkInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AdmittedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    // The inner subscription runs to completion even if the HTTP client leaves.
    // Current routes return finite handler results; SSE uses manual Express responses.
    return defer(() =>
      trackRequestWork(request, () => lastValueFrom(next.handle())),
    ).pipe(
      tap(() => {
        if (
          String(response.getHeader('Content-Type')).startsWith(
            'text/event-stream',
          )
        )
          request[REQUEST_WORK]?.clearDeadline();
      }),
    );
  }
}
