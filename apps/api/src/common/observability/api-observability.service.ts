import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  externalCounters,
  externalServiceMetrics,
} from './external-service.metrics.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ApiCapacityService } from '../load-shedding/api-capacity.service.js';
import {
  apiObservation,
  type ApiObservation,
} from './api-observation.context.js';

const boundsMs = [10, 25, 50, 100, 250, 500, 1000, 1500, 2000, 4000, 10000];
const methods = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
const empty = () => ({
  statusClasses: {
    informational: 0,
    success: 0,
    redirect: 0,
    clientError: 0,
    serverError: 0,
  },
  count: 0,
  failures: 0,
  throttled: 0,
  unavailable: 0,
  timedOut: 0,
  aborted: 0,
  streams: 0,
  latencyCount: 0,
  totalMs: 0,
  maxMs: 0,
  buckets: Array<number>(boundsMs.length + 1).fill(0),
});
type RouteMetrics = ReturnType<typeof empty>;

export function latencyTail(
  metrics: RouteMetrics,
  percentile: number,
  minimum: number,
) {
  if (metrics.latencyCount < minimum)
    return { status: 'insufficient', upperBoundMs: null };
  const rank = Math.ceil(metrics.latencyCount * percentile);
  let cumulative = 0;
  for (let index = 0; index < metrics.buckets.length; index++) {
    cumulative += metrics.buckets[index];
    if (cumulative >= rank)
      return index < boundsMs.length
        ? { status: 'bucket-bound', upperBoundMs: boundsMs[index] }
        : { status: 'overflow', upperBoundMs: null };
  }
  return { status: 'invalid', upperBoundMs: null };
}

@Injectable()
export class ApiObservabilityService implements OnModuleDestroy {
  private readonly logger = new Logger(ApiObservabilityService.name);
  readonly instanceId = randomUUID();
  private readonly started = performance.now();
  private cpu = process.cpuUsage();
  private cpuAt = this.started;
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly routes = new Map<string, RouteMetrics>();
  private readonly total = empty();
  private inFlight = 0;
  private peakInFlight = 0;
  private suppressed = 0;
  private emitted = 0;
  private logWindow = this.started;
  private readonly requestLogLimit: number;
  private readonly slowMs: number;
  private readonly timer?: ReturnType<typeof setInterval>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly capacity: ApiCapacityService,
  ) {
    const integer = (
      key: string,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const value = Number(config.get(key) ?? fallback);
      if (!Number.isInteger(value) || value < min || value > max)
        throw new Error(`Invalid ${key}`);
      return value;
    };
    this.requestLogLimit = integer(
      'API_OBSERVABILITY_REQUEST_LOG_LIMIT',
      10,
      0,
      100,
    );
    this.slowMs = integer('API_OBSERVABILITY_SLOW_MS', 1000, 100, 60_000);
    const interval = integer(
      'API_OBSERVABILITY_LOG_INTERVAL_MS',
      config.get('NODE_ENV') === 'production' ? 60_000 : 0,
      0,
      300_000,
    );
    if (interval !== 0 && interval < 10_000)
      throw new Error(
        'Observability interval must be zero or at least 10000ms',
      );
    this.loop.enable();
    if (interval) {
      this.timer = setInterval(
        () =>
          this.logger.log(
            JSON.stringify({ event: 'api.metrics', ...this.snapshot() }),
          ),
        interval,
      );
      this.timer.unref();
    }
  }

  observe(request: Request, response: Response, next: () => void) {
    const observation: ApiObservation = {
      requestId: randomUUID(),
      database: { count: 0, failures: 0, totalMs: 0, maxMs: 0 },
      external: {
        'http-headers': externalCounters(),
        'turnstile-verification': externalCounters(),
        'storage-upload': externalCounters(),
        'storage-remove': externalCounters(),
      },
    };
    response.setHeader('X-Request-ID', observation.requestId);
    const started = performance.now();
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      response.off('finish', finish);
      response.off('close', finish);
      this.inFlight--;
      const raw: unknown = (request.route as { path?: unknown } | undefined)
        ?.path;
      const route =
        typeof raw === 'string' &&
        raw.length <= 180 &&
        /^[\w/:.{}*-]+$/.test(raw)
          ? raw
          : 'unmatched';
      const method = methods.has(request.method) ? request.method : 'OTHER';
      let key = `${method} ${route}`;
      if (!this.routes.has(key) && this.routes.size >= 127)
        key = 'OTHER overflow';
      const metrics = this.routes.get(key) ?? empty();
      this.routes.set(key, metrics);
      const aborted = !response.writableFinished;
      const status = aborted ? null : response.statusCode;
      const stream = String(response.getHeader('Content-Type')).startsWith(
        'text/event-stream',
      );
      const ms = performance.now() - started;
      for (const group of [this.total, metrics]) {
        if (status !== null) {
          const statusClass =
            status >= 500
              ? 'serverError'
              : status >= 400
                ? 'clientError'
                : status >= 300
                  ? 'redirect'
                  : status >= 200
                    ? 'success'
                    : 'informational';
          group.statusClasses[statusClass]++;
        }
        group.count++;
        group.aborted += Number(aborted);
        group.streams += Number(stream);
        group.failures += Number(status !== null && status >= 500);
        group.throttled += Number(status === 429);
        group.unavailable += Number(status === 503);
        group.timedOut += Number(
          status === 504 || observation.failure === 'request-timeout',
        );
        if (!aborted && !stream) {
          group.latencyCount++;
          group.totalMs += ms;
          group.maxMs = Math.max(group.maxMs, ms);
          const bucket = boundsMs.findIndex((bound) => ms <= bound);
          group.buckets[bucket < 0 ? boundsMs.length : bucket]++;
        }
      }
      if (
        (status !== null && status >= 500) ||
        (!stream &&
          !aborted &&
          status !== null &&
          status < 400 &&
          ms >= this.slowMs)
      ) {
        const now = performance.now();
        if (now - this.logWindow >= 60_000) {
          this.logWindow = now;
          this.emitted = 0;
        }
        if (this.emitted < this.requestLogLimit) {
          this.emitted++;
          this.logger.log(
            JSON.stringify({
              event: 'api.request.diagnostic',
              schemaVersion: 1,
              instanceId: this.instanceId,
              requestId: observation.requestId,
              route: key,
              status,
              durationMs: ms,
              failure: observation.failure,
              database: { ...observation.database },
              external: observation.external,
            }),
          );
        } else this.suppressed++;
      }
    };
    response.once('finish', finish);
    response.once('close', finish);
    apiObservation.run(observation, next);
  }

  snapshot() {
    const now = performance.now(),
      cpu = process.cpuUsage(),
      memory = process.memoryUsage();
    const cpuCoreEquivalent =
      (cpu.user + cpu.system - this.cpu.user - this.cpu.system) /
      Math.max(1, (now - this.cpuAt) * 1000);
    this.cpu = cpu;
    this.cpuAt = now;
    const copy = (metrics: RouteMetrics) => ({
      ...metrics,
      statusClasses: { ...metrics.statusClasses },
      buckets: [...metrics.buckets],
      p50: latencyTail(metrics, 0.5, 1),
      p95: latencyTail(metrics, 0.95, 100),
      p99: latencyTail(metrics, 0.99, 1000),
    });
    const processMetrics = {
      cpuCoreEquivalent,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      eventLoopP95Ms: this.loop.percentile(95) / 1e6,
      eventLoopMaxMs: this.loop.max / 1e6,
    };
    this.loop.reset();
    return {
      service: 'paserve-api',
      schemaVersion: 1,
      instanceId: this.instanceId,
      at: new Date().toISOString(),
      uptimeMs: now - this.started,
      inFlight: this.inFlight,
      peakInFlight: this.peakInFlight,
      total: copy(this.total),
      latencyBoundsMs: [...boundsMs],
      routes: [...this.routes].map(([route, metrics]) => ({
        route,
        ...copy(metrics),
      })),
      suppressedDiagnostics: this.suppressed,
      process: processMetrics,
      capacity: this.capacity.snapshot(),
      external: externalServiceMetrics.snapshot(),
      // Some focused HTTP fixtures intentionally stub Prisma without pool metrics.
      database:
        typeof this.prisma.databasePoolSnapshot === 'function'
          ? this.prisma.databasePoolSnapshot()
          : null,
    };
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.loop.disable();
  }
}
