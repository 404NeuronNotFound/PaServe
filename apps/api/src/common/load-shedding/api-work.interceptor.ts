import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ShopMemberRequest } from '../../modules/shop-members/guards/shop-membership.guard.js';
import {
  FairnessLimitedException,
  fairnessScopes,
  TrafficFairnessService,
} from './traffic-fairness.service.js';
import { defer, lastValueFrom, tap } from 'rxjs';
import {
  REQUEST_WORK,
  trackRequestWork,
  type AdmittedRequest,
} from './request-work.js';

@Injectable()
export class ApiWorkInterceptor implements NestInterceptor {
  constructor(private readonly fairness: TrafficFairnessService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AdmittedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    // The inner subscription runs to completion even if the HTTP client leaves.
    // Current routes return finite handler results; SSE uses manual Express responses.
    return defer(async () => {
      let release: (() => void) | undefined;
      try {
        release = this.fairness.acquire(
          fairnessScopes(request as ShopMemberRequest),
          request[REQUEST_WORK]?.workload ?? 'general',
          request[REQUEST_WORK]?.menuRead ?? false,
        );
      } catch (error) {
        if (error instanceof FairnessLimitedException) {
          response.setHeader('Retry-After', error.retryAfter);
          response.setHeader('Cache-Control', 'no-store');
        }
        throw error;
      }
      if (request[REQUEST_WORK]) request[REQUEST_WORK].addRelease(release);
      try {
        return await trackRequestWork(request, () =>
          lastValueFrom(next.handle()),
        );
      } finally {
        if (!request[REQUEST_WORK]) release();
      }
    }).pipe(
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
