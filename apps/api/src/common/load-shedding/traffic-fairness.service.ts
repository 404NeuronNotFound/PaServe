import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';
import type { Workload } from './api-capacity.service.js';

export class FairnessLimitedException extends HttpException {
  constructor(readonly retryAfter = 1) {
    super(
      {
        code: 'FAIRNESS_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait before trying again.',
      },
      429,
    );
  }
}

type Scope = { key: string; kind: 'tenant' | 'account' };
type State = {
  active: number;
  ordinary: number;
  menu: number;
  streams: number;
  expensive: number;
  tokens: number;
  criticalTokens: number;
  menuTokens: number;
  at: number;
  touched: number;
};

/** Only server-installed authenticated context may select private budgets. */
export function fairnessScopes(request: {
  params: Record<string, unknown>;
  user?: { id: string };
  shopMembership?: { shopId: string };
}): Scope[] {
  const scopes: Scope[] = [];
  if (request.user?.id) {
    scopes.push({ key: `account:${request.user.id}`, kind: 'account' });
    const shopId = request.shopMembership?.shopId;
    if (
      shopId &&
      typeof request.params.shopId === 'string' &&
      shopId.toLowerCase() === request.params.shopId.toLowerCase()
    )
      scopes.push({ key: `private:${shopId.toLowerCase()}`, kind: 'tenant' });
  }
  // Public routes are intentionally separate: anonymous callers cannot exhaust
  // a verified staff tenant's budget by sending its slug or an identity header.
  if (typeof request.params.shopSlug === 'string') {
    const slug = request.params.shopSlug;
    scopes.push({
      key:
        slug.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
          ? `public:${slug}`
          : 'invalid-public-target',
      kind: 'tenant',
    });
  }
  return scopes;
}

@Injectable()
export class TrafficFairnessService {
  readonly limits;
  private readonly states = new Map<string, State>();
  private nextSweep = 0;
  private readonly counts = {
    admitted: 0,
    concurrencyRejected: 0,
    rateRejected: 0,
    capacityRejected: 0,
  };
  constructor(config: ConfigService) {
    const integer = (name: string, fallback: number, max: number) => {
      const value = Number(config.get(name) ?? fallback);
      if (!Number.isInteger(value) || value < 1 || value > max)
        throw new Error(`${name} must be an integer between 1 and ${max}`);
      return value;
    };
    const total = integer('API_MAX_IN_FLIGHT', 128, 4096);
    const tenantMax = Math.max(1, Math.floor(total / 4));
    const maxScopes = integer('API_FAIR_MAX_SCOPES', 4096, 100000);
    this.limits = Object.freeze({
      tenant: Object.freeze({
        concurrent: integer(
          'API_FAIR_TENANT_IN_FLIGHT',
          Math.min(32, tenantMax),
          tenantMax,
        ),
        burst: integer('API_FAIR_TENANT_BURST', 300, 10000),
        perMinute: integer('API_FAIR_TENANT_PER_MINUTE', 1200, 60000),
      }),
      account: Object.freeze({
        concurrent: integer(
          'API_FAIR_ACCOUNT_IN_FLIGHT',
          Math.min(8, tenantMax),
          tenantMax,
        ),
        burst: integer('API_FAIR_ACCOUNT_BURST', 60, 10000),
        perMinute: integer('API_FAIR_ACCOUNT_PER_MINUTE', 600, 60000),
      }),
      maxScopes,
      protectedScopeReserve: Math.floor(maxScopes / 8),
    });
  }

  acquire(
    scopes: readonly Scope[],
    workload: Workload,
    menuRead = false,
  ): () => void {
    // Liveness/readiness and unscoped routes do not scan or allocate scope state.
    if (!scopes.length) return () => {};
    const now = Date.now();
    const ordinary = workload !== 'critical';
    if (now >= this.nextSweep) {
      for (const [key, state] of this.states) {
        const rule = key.startsWith('account:')
          ? this.limits.account
          : this.limits.tenant;
        const idle = Math.max(120000, (rule.burst * 60000) / rule.perMinute);
        if (!state.active && now - state.touched >= idle)
          this.states.delete(key);
      }
      this.nextSweep = now + 5000;
    }
    const unique = [
      ...new Map(scopes.map((scope) => [scope.key, scope])).values(),
    ];
    const newScopes = unique.filter(
      (scope) => !this.states.has(scope.key),
    ).length;
    if (
      newScopes > 0 &&
      this.states.size + newScopes >
        this.limits.maxScopes -
          (menuRead || workload === 'critical'
            ? 0
            : this.limits.protectedScopeReserve)
    ) {
      this.counts.capacityRejected++;
      throw new ApiOverloadedException();
    }
    const candidates = unique.map((scope) => {
      const rule = this.limits[scope.kind];
      const state = this.states.get(scope.key) ?? {
        active: 0,
        ordinary: 0,
        menu: 0,
        streams: 0,
        expensive: 0,
        tokens: rule.burst,
        criticalTokens: rule.burst,
        menuTokens: rule.burst,
        at: now,
        touched: now,
      };
      const refill = (Math.max(0, now - state.at) * rule.perMinute) / 60000;
      return {
        scope,
        publicScope:
          scope.key.startsWith('public:') ||
          scope.key === 'invalid-public-target',
        menuRead:
          menuRead &&
          workload === 'general' &&
          (scope.key.startsWith('public:') ||
            scope.key === 'invalid-public-target'),
        rule,
        state,
        tokens: Math.min(rule.burst, state.tokens + refill),
        criticalTokens: Math.min(rule.burst, state.criticalTokens + refill),
        menuTokens: Math.min(rule.burst, state.menuTokens + refill),
      };
    });
    for (const {
      scope,
      rule,
      state,
      tokens,
      criticalTokens,
      menuTokens,
      publicScope,
      menuRead: menu,
    } of candidates) {
      const reserve =
        rule.concurrent > 1 ? Math.max(1, Math.floor(rule.concurrent / 4)) : 0;
      const ordinaryCap = rule.concurrent - reserve;
      const menuReserve =
        publicScope && ordinaryCap > 1
          ? Math.max(1, Math.floor(ordinaryCap / 4))
          : 0;
      if (
        state.active >= rule.concurrent ||
        (ordinary && state.ordinary >= rule.concurrent - reserve) ||
        (ordinary &&
          !menu &&
          publicScope &&
          state.ordinary - state.menu >= ordinaryCap - menuReserve) ||
        (workload === 'stream' &&
          state.streams >=
            Math.max(
              1,
              Math.floor(rule.concurrent / (scope.kind === 'account' ? 2 : 4)),
            )) ||
        (workload === 'expensive' &&
          state.expensive >=
            Math.max(1, Math.min(8, rule.concurrent - reserve)))
      ) {
        this.counts.concurrencyRejected++;
        throw new FairnessLimitedException();
      }
      const available = menu ? menuTokens : ordinary ? tokens : criticalTokens;
      if (available < 1) {
        this.counts.rateRejected++;
        throw new FairnessLimitedException(
          Math.max(1, Math.ceil(((1 - available) * 60) / rule.perMinute)),
        );
      }
    }
    // Check every scope before committing any charge. Rejected retries neither
    // extend a lockout nor allocate identities, timers, queues or per-hit logs.
    for (const {
      scope,
      state,
      tokens,
      criticalTokens,
      menuTokens,
      menuRead: menu,
    } of candidates) {
      Object.assign(state, {
        tokens: tokens - Number(ordinary && !menu),
        criticalTokens: criticalTokens - Number(!ordinary),
        menuTokens: menuTokens - Number(menu),
        at: now,
        touched: now,
      });
      state.active++;
      state.ordinary += Number(ordinary);
      state.menu += Number(menu);
      state.streams += Number(workload === 'stream');
      state.expensive += Number(workload === 'expensive');
      this.states.set(scope.key, state);
    }
    if (candidates.length) this.counts.admitted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const { state, menuRead: menu } of candidates) {
        state.active--;
        state.ordinary -= Number(ordinary);
        state.menu -= Number(menu);
        state.streams -= Number(workload === 'stream');
        state.expensive -= Number(workload === 'expensive');
        state.touched = Date.now();
      }
    };
  }
  snapshot() {
    return {
      limits: this.limits,
      ...this.counts,
      trackedScopes: this.states.size,
      activeScopeLeases: [...this.states.values()].reduce(
        (total, state) => total + state.active,
        0,
      ),
    };
  }
  onApplicationShutdown() {
    this.states.clear();
  }
}
