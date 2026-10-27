import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_POLICY,
  AUTH_RATE_WINDOWS,
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitPolicy,
} from './rate-limit.policy.js';

@Injectable()
export class ApiRateLimitGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const name =
      this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'general';
    const policy = RATE_LIMITS[name];
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    // Use Express's trust-aware IP, including the library's IPv6 /64 normalization.
    // Never key on unverified authorization, cookies, tokens or body/header shop hints.
    const tracker = await this.getTracker(request);
    const buckets: { scope: string; limit: number; ttl: number }[] = [
      { scope: 'all', limit: policy.aggregate, ttl: RATE_LIMIT_WINDOW_MS },
      ...(AUTH_RATE_WINDOWS[name] ?? []),
    ];
    if (policy.shop) {
      const target = request.params.shopId ?? request.params.shopSlug;
      // PostgreSQL UUIDs are case-insensitive; casing must not create fresh budgets.
      const shop =
        typeof target === 'string'
          ? request.params.shopId
            ? target.toLowerCase()
            : target
          : 'missing';
      buckets.push({
        scope: `shop:${shop}`,
        limit: policy.limit,
        ttl: RATE_LIMIT_WINDOW_MS,
      });
    }
    for (const bucket of buckets) {
      const key = createHash('sha256')
        .update(
          JSON.stringify(['paserve:rate:v1', name, tracker, bucket.scope]),
        )
        .digest('hex');
      // Zero blockDuration uses rolling hit expirations rather than extending a
      // lockout with every rejected retry. Check the aggregate before allocating shop buckets.
      const result = await this.storageService.increment(
        key,
        bucket.ttl,
        bucket.limit,
        0,
        'default',
      );
      const retryAfter = Math.max(1, result.timeToBlockExpire);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-RateLimit-Limit', bucket.limit);
      response.setHeader(
        'X-RateLimit-Remaining',
        Math.max(0, bucket.limit - Math.min(result.totalHits, bucket.limit)),
      );
      response.setHeader(
        'X-RateLimit-Reset',
        result.isBlocked ? retryAfter : result.timeToExpire,
      );
      if (result.isBlocked) {
        response.setHeader('Retry-After', retryAfter);
        throw new HttpException(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please wait before trying again.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
