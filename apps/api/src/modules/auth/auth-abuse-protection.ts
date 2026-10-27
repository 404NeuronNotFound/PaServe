import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response } from 'express';
import { defer, finalize } from 'rxjs';
import { RATE_LIMIT_POLICY } from '../../common/rate-limiting/rate-limit.policy.js';

const WINDOW_MS = 60_000;
const ACCOUNT_ATTEMPTS = 20;
const MAX_ACCOUNTS = 10_000;

/** Local admission only. Replicas must also share an edge/distributed budget. */
@Injectable()
export class AuthAbuseProtection implements OnApplicationShutdown {
  private readonly salt = randomBytes(32);
  private readonly accounts = new Map<
    string,
    { hits: number; expires: number }
  >();
  private active = 0;
  private tokens = 10;
  private updated = performance.now();
  private readonly concurrency: number;
  private readonly perMinute: number;

  constructor(config: ConfigService) {
    this.concurrency = this.setting(config, 'AUTH_MAX_CONCURRENT', 2, 32);
    this.perMinute = this.setting(config, 'AUTH_ATTEMPTS_PER_MINUTE', 60, 6000);
  }

  private setting(
    config: ConfigService,
    name: string,
    fallback: number,
    max: number,
  ) {
    const value = config.get<string | number>(name) ?? fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw new Error(`${name} must be an integer between 1 and ${max}`);
    }
    return parsed;
  }

  acquire(response: Response, loginEmail?: unknown): () => void {
    response.setHeader('Cache-Control', 'no-store');
    const now = performance.now();
    this.tokens = Math.min(
      10,
      this.tokens + ((now - this.updated) * this.perMinute) / WINDOW_MS,
    );
    this.updated = now;
    if (this.active >= this.concurrency) this.reject(response, 1);
    if (this.tokens < 1) {
      this.reject(
        response,
        Math.ceil(((1 - this.tokens) * WINDOW_MS) / this.perMinute / 1000),
      );
    }

    // Unvalidated bodies cannot allocate arbitrary-sized keys. Never retain email/password.
    if (typeof loginEmail === 'string' && loginEmail.length <= 512) {
      const key = createHmac('sha256', this.salt)
        .update(loginEmail.trim().toLowerCase())
        .digest('hex');
      for (const [expiredKey, entry] of this.accounts) {
        if (entry.expires > now) break;
        this.accounts.delete(expiredKey);
      }
      const previous = this.accounts.get(key);
      if (previous && previous.hits >= ACCOUNT_ATTEMPTS) {
        this.reject(response, Math.ceil((previous.expires - now) / 1000));
      }
      if (!previous && this.accounts.size >= MAX_ACCOUNTS)
        this.reject(response, 1);
      this.accounts.set(
        key,
        previous
          ? { ...previous, hits: previous.hits + 1 }
          : { hits: 1, expires: now + WINDOW_MS },
      );
    }
    this.tokens -= 1;
    this.active += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active -= 1;
      }
    };
  }

  private reject(response: Response, seconds: number): never {
    response.setHeader('Retry-After', Math.max(1, seconds));
    throw new HttpException(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message:
          'Too many authentication attempts. Please wait before trying again.',
      },
      429,
    );
  }

  onApplicationShutdown() {
    this.accounts.clear();
    this.tokens = 10;
    this.updated = performance.now();
  }
}

@Injectable()
export class AuthWorkInterceptor implements NestInterceptor {
  constructor(private readonly protection: AuthAbuseProtection) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    // Policy metadata avoids relying on method names, URL spelling or query strings.
    const email: unknown =
      Reflect.getMetadata(RATE_LIMIT_POLICY, context.getHandler()) === 'login'
        ? (request.body as { email?: unknown } | undefined)?.email
        : undefined;
    return defer(() => {
      const release = this.protection.acquire(response, email);
      // finalize covers validation errors, thrown handlers and normal completion.
      return defer(() => next.handle()).pipe(finalize(release));
    });
  }
}
