import {
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeIp } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  RATE_LIMIT_POLICY,
  type RateLimitPolicy,
} from '../rate-limiting/rate-limit.policy.js';
import { ApiCapacityService, type Workload } from './api-capacity.service.js';
import {
  REQUEST_WORK,
  RequestWork,
  type AdmittedRequest,
} from './request-work.js';
import {
  CRITICAL_CAPACITY,
  READINESS_CAPACITY,
  CriticalAccessService,
} from './critical-capacity.js';
import { RequestDeadlineService } from '../http/request-deadline.service.js';
import { MENU_READ_CAPACITY } from './menu-read-capacity.js';

const livenessKey = Symbol('paserve:liveness');
/** Only for a constant-time endpoint that never accesses dependencies. */
export const CapacityLiveness = () => SetMetadata(livenessKey, true);

@Injectable()
export class ApiAdmissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capacity: ApiCapacityService,
    private readonly criticalAccess: CriticalAccessService,
    private readonly deadlines: RequestDeadlineService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.get<boolean>(livenessKey, context.getHandler()))
      return true;
    const request = context.switchToHttp().getRequest<AdmittedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_POLICY,
      [context.getHandler(), context.getClass()],
    );
    const targets = [context.getHandler(), context.getClass()];
    const workload: Workload = this.reflector.get<boolean>(
      READINESS_CAPACITY,
      context.getHandler(),
    )
      ? 'health'
      : this.reflector.getAllAndOverride<boolean>(CRITICAL_CAPACITY, targets) &&
          this.criticalAccess.eligible(request.headers.authorization)
        ? 'critical'
        : policy === 'login' || policy === 'register' || policy === 'refresh'
          ? 'auth'
          : policy === 'stream'
            ? 'stream'
            : policy === 'reports' || policy === 'upload'
              ? 'expensive'
              : 'general';
    // Express applies the configured trusted proxy list. Ignore all other identity hints.
    const menuRead =
      request.method === 'GET' &&
      workload === 'general' &&
      Boolean(
        this.reflector.getAllAndOverride<boolean>(MENU_READ_CAPACITY, targets),
      );
    const release = this.capacity.acquire(
      normalizeIp(request.ip ?? 'unknown'),
      workload,
      menuRead,
    );
    const admission = new RequestWork(
      () => {
        response.off('finish', close);
        response.off('close', close);
        release();
      },
      workload,
      menuRead,
      policy === 'reports'
        ? 'analytics'
        : [
              'orderCreate',
              'orderAction',
              'quote',
              'receiptRead',
              'receiptProof',
            ].includes(policy ?? '')
          ? 'orders'
          : 'other',
    );
    const close = () => admission.close();
    request[REQUEST_WORK] = admission;
    response.once('finish', close);
    response.once('close', close);
    admission.startDeadline(
      this.deadlines.forRequest(request.method, policy, workload === 'health'),
      (error) => {
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) {
          response.end();
          return;
        }
        response.setHeader('Cache-Control', 'no-store');
        response.status(error.getStatus()).json({
          statusCode: error.getStatus(),
          ...(error.getResponse() as object),
        });
      },
    );
    if (response.destroyed || response.writableEnded) admission.close();
    return true;
  }
}
