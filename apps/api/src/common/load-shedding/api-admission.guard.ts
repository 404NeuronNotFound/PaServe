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

const livenessKey = Symbol('paserve:liveness');
/** Only for a constant-time endpoint that never accesses dependencies. */
export const CapacityLiveness = () => SetMetadata(livenessKey, true);

@Injectable()
export class ApiAdmissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capacity: ApiCapacityService,
    private readonly criticalAccess: CriticalAccessService,
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
    const release = this.capacity.acquire(
      normalizeIp(request.ip ?? 'unknown'),
      workload,
    );
    const admission = new RequestWork(() => {
      response.off('finish', close);
      response.off('close', close);
      release();
    });
    const close = () => admission.close();
    request[REQUEST_WORK] = admission;
    response.once('finish', close);
    response.once('close', close);
    if (response.destroyed || response.writableEnded) admission.close();
    return true;
  }
}
