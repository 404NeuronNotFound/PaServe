import {
  HttpException,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeIp } from '@nestjs/throttler';
import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response } from 'express';
import { boundedFetch } from '../../common/http/request-context.js';

type Action = 'login' | 'register';
type Risk = {
  action: Action;
  ip: string;
  account?: string;
  sourceAccount?: string;
};
const RISK_TTL = 15 * 60_000;
const MAX_RISK_KEYS = 20_000;
const MAX_TOKENS = 2000;

@Injectable()
export class BotChallengeService implements OnApplicationShutdown {
  private readonly enabled: boolean;
  private readonly secret: string;
  private readonly hostnames: Set<string>;
  private readonly salt = randomBytes(32);
  private readonly risks = new Map<string, { hits: number; expires: number }>();
  private readonly used = new Map<string, number>();
  private verifying = 0;
  private budget = 10;
  private updated = performance.now();

  constructor(config: ConfigService) {
    const production = config.get<string>('NODE_ENV') === 'production';
    const setting =
      config.get<string>('AUTH_BOT_CHALLENGE_ENABLED') ?? String(production);
    if (!['true', 'false'].includes(setting))
      throw new Error('AUTH_BOT_CHALLENGE_ENABLED must be true or false');
    this.enabled = setting === 'true';
    this.secret = config.get<string>('TURNSTILE_SECRET_KEY')?.trim() ?? '';
    const names =
      config
        .get<string>('TURNSTILE_HOSTNAMES')
        ?.split(',')
        .map((value) => value.trim().toLowerCase()) ?? [];
    this.hostnames = new Set(names);
    if (
      this.enabled &&
      (!this.secret ||
        !names.length ||
        names.some((name) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(name)))
    ) {
      throw new Error(
        'Enabled bot challenges require TURNSTILE_SECRET_KEY and explicit TURNSTILE_HOSTNAMES without ports, paths or wildcards',
      );
    }
    if (this.enabled && production && /^[123]x0{10}/u.test(this.secret))
      throw new Error('Turnstile testing keys are not allowed in production');
  }

  private digest(value: string) {
    return createHmac('sha256', this.salt).update(value).digest('hex');
  }

  assess(request: Request, policy: unknown): Risk | undefined {
    if (!this.enabled || (policy !== 'login' && policy !== 'register'))
      return undefined;
    const email: unknown = (request.body as { email?: unknown } | undefined)
      ?.email;
    const ip = normalizeIp(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    const account =
      policy === 'login' && typeof email === 'string' && email.length <= 512
        ? email.trim().toLowerCase()
        : undefined;
    return {
      action: policy,
      ip: this.digest(`${policy}:ip:${ip}`),
      account:
        account !== undefined
          ? this.digest(`login:account:${account}`)
          : undefined,
      sourceAccount:
        account !== undefined
          ? this.digest(JSON.stringify(['login:source-account', ip, account]))
          : undefined,
    };
  }

  private prune() {
    const now = performance.now();
    for (const [key, entry] of this.risks) {
      if (entry.expires > now) break;
      this.risks.delete(key);
    }
    for (const [key, expires] of this.used) {
      if (expires > now) break;
      this.used.delete(key);
    }
  }

  private increment(key: string) {
    const previous = this.risks.get(key);
    if (!previous && this.risks.size >= MAX_RISK_KEYS) return;
    this.risks.set(
      key,
      previous
        ? { ...previous, hits: Math.min(20, previous.hits + 1) }
        : { hits: 1, expires: performance.now() + RISK_TTL },
    );
  }

  started(risk?: Risk) {
    if (risk?.action === 'register') this.increment(risk.ip);
  }

  succeeded(risk?: Risk) {
    if (risk?.action !== 'login') return;
    this.risks.delete(risk.ip);
    if (risk.sourceAccount) this.risks.delete(risk.sourceAccount);
  }

  failed(risk: Risk | undefined, error: unknown) {
    if (
      risk?.action !== 'login' ||
      !(error instanceof HttpException) ||
      error.getStatus() !== 401
    )
      return;
    this.increment(risk.ip);
    if (risk.account) this.increment(risk.account);
    if (risk.sourceAccount) this.increment(risk.sourceAccount);
  }

  private required(risk: Risk) {
    this.prune();
    return (
      (this.risks.get(risk.ip)?.hits ?? 0) >=
        (risk.action === 'login' ? 3 : 2) ||
      // An attacker-controlled email alone must never gate a clean victim.
      // Aggregate account risk only escalates a source that already failed it.
      (risk.account &&
        (this.risks.get(risk.account)?.hits ?? 0) >= 5 &&
        risk.sourceAccount &&
        (this.risks.get(risk.sourceAccount)?.hits ?? 0) > 0)
    );
  }

  private challenge(): never {
    throw new HttpException(
      {
        code: 'BOT_CHALLENGE_REQUIRED',
        message: 'Please complete the security check, then try again.',
      },
      403,
    );
  }

  private unavailable(response: Response): never {
    response.setHeader('Retry-After', 5);
    throw new HttpException(
      {
        code: 'BOT_CHALLENGE_UNAVAILABLE',
        message:
          'The security check is temporarily unavailable. Please try again shortly.',
      },
      503,
    );
  }

  async check(
    risk: Risk | undefined,
    token: unknown,
    response: Response,
  ): Promise<void> {
    if (!risk || !this.required(risk)) return;
    response.setHeader('Cache-Control', 'no-store');
    if (typeof token !== 'string' || !token.trim() || token.length > 2048)
      this.challenge();
    const digest = this.digest(`token:${token}`);
    if (this.used.has(digest)) this.challenge();
    const now = performance.now();
    this.budget = Math.min(10, this.budget + (now - this.updated) / 1000);
    this.updated = now;
    if (this.verifying >= 2 || this.budget < 1 || this.used.size >= MAX_TOKENS)
      this.unavailable(response);
    this.budget -= 1;
    this.verifying += 1;
    // Reserve before the network call. Concurrent duplicates and uncertain
    // timeout outcomes need a fresh token, never another verification request.
    this.used.set(digest, now + 300_000);
    let result: Record<string, unknown>;
    try {
      const reply = await boundedFetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: this.secret, response: token }),
          signal: AbortSignal.timeout(3500),
          redirect: 'error',
        },
      );
      if (!reply.ok) this.unavailable(response);
      const parsed: unknown = await reply.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        this.unavailable(response);
      result = parsed as Record<string, unknown>;
    } catch {
      this.unavailable(response);
    } finally {
      this.verifying -= 1;
    }
    if (
      Array.isArray(result['error-codes']) &&
      result['error-codes'].some((code) =>
        [
          'internal-error',
          'invalid-input-secret',
          'missing-input-secret',
        ].includes(String(code)),
      )
    )
      this.unavailable(response);
    const timestamp =
      typeof result.challenge_ts === 'string'
        ? Date.parse(result.challenge_ts)
        : NaN;
    const age = Date.now() - timestamp;
    if (
      result.success !== true ||
      result.action !== risk.action ||
      typeof result.hostname !== 'string' ||
      !this.hostnames.has(result.hostname.toLowerCase()) ||
      !Number.isFinite(age) ||
      age < -30_000 ||
      age > 300_000
    )
      this.challenge();
  }

  onApplicationShutdown() {
    this.risks.clear();
    this.used.clear();
    this.budget = 10;
    this.updated = performance.now();
  }
}
