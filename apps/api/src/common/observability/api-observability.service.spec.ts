import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  ApiObservabilityService,
  latencyTail,
} from './api-observability.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { ApiCapacityService } from '../load-shedding/api-capacity.service.js';

function response(stream = false) {
  return Object.assign(new EventEmitter(), {
    writableFinished: true,
    statusCode: 200,
    setHeader: vi.fn(),
    getHeader: () => (stream ? 'text/event-stream' : 'application/json'),
  }) as unknown as Response;
}
const req = (path = '/shops/:shopId/orders/:orderId', method = 'GET') =>
  ({
    method,
    route: { path },
    originalUrl: '/private?token=secret',
    headers: { authorization: 'secret' },
  }) as unknown as Request;

describe('bounded API observability', () => {
  let service: ApiObservabilityService;
  beforeEach(() => {
    service = new ApiObservabilityService(
      new ConfigService({ API_OBSERVABILITY_REQUEST_LOG_LIMIT: 2 }),
      {
        databasePoolSnapshot: () => ({ total: 1, waiting: 0 }),
      } as unknown as PrismaService,
      {
        snapshot: () => ({ active: { total: 0 } }),
      } as unknown as ApiCapacityService,
    );
  });
  afterEach(() => {
    service.onModuleDestroy();
    vi.restoreAllMocks();
  });

  it('records exactly once with route templates and no sensitive request data', () => {
    const res = response();
    service.observe(req(), res, () => {});
    expect(service.snapshot().inFlight).toBe(1);
    res.emit('finish');
    res.emit('close');
    const metrics = service.snapshot();
    expect(metrics.total.count).toBe(1);
    expect(metrics.inFlight).toBe(0);
    expect(metrics.routes[0].route).toBe('GET /shops/:shopId/orders/:orderId');
    expect(JSON.stringify(metrics)).not.toMatch(/private|secret|authorization/);
    metrics.total.statusClasses.success = 999;
    metrics.routes[0].buckets[0] = -1;
    expect(service.snapshot().total.statusClasses.success).toBe(1);
    expect(service.snapshot().routes[0].buckets[0]).toBeGreaterThanOrEqual(0);
  });
  it('accounts for aborts and stream lifetimes without polluting request latency', () => {
    const aborted = response();
    Object.assign(aborted, { writableFinished: false });
    service.observe(req(), aborted, () => {});
    aborted.emit('close');
    const stream = response(true);
    service.observe(req('/events'), stream, () => {});
    stream.emit('finish');
    const snapshot = service.snapshot();
    expect(snapshot.total.aborted).toBe(1);
    expect(snapshot.total.streams).toBe(1);
    expect(snapshot.total.latencyCount).toBe(0);
    expect(snapshot.total.failures).toBe(0);
  });
  it('counts all failures while capping diagnostic logs per minute', () => {
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    for (let index = 0; index < 20; index++) {
      const res = response();
      Object.assign(res, { statusCode: 503 });
      service.observe(req(), res, () => {});
      res.emit('finish');
    }
    expect(service.snapshot().total.unavailable).toBe(20);
    expect(service.snapshot().suppressedDiagnostics).toBe(18);
    expect(logs).toHaveBeenCalledTimes(2);
    const record = JSON.parse(logs.mock.calls[0][0] as string);
    expect(record.requestId).toMatch(/^[\da-f-]{36}$/);
    expect(record.event).toBe('api.request.diagnostic');
    expect(JSON.stringify(record)).not.toMatch(/private|secret/);
  });
  it('keeps authentication failures and throttling log-free', () => {
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    for (const statusCode of [401, 403, 429]) {
      const res = response();
      Object.assign(res, { statusCode });
      service.observe(req('/auth/login', 'POST'), res, () => {});
      const clock = vi
        .spyOn(performance, 'now')
        .mockReturnValue(performance.now() + 2000);
      res.emit('finish');
      clock.mockRestore();
    }
    expect(logs).not.toHaveBeenCalled();
    expect(service.snapshot().total.throttled).toBe(1);
    expect(service.snapshot().total.statusClasses.clientError).toBe(3);
  });
  it('caps route cardinality and groups unmatched request paths', () => {
    for (let index = 0; index < 200; index++) {
      const res = response();
      service.observe(req(`/fixture-${index}`), res, () => {});
      res.emit('finish');
    }
    const res = response();
    service.observe({ method: 'GET' } as Request, res, () => {});
    res.emit('finish');
    expect(service.snapshot().routes.length).toBeLessThanOrEqual(128);
    expect(service.snapshot().total.count).toBe(201);
    expect(
      service
        .snapshot()
        .routes.some((route) => route.route === 'OTHER overflow'),
    ).toBe(true);
  });
  it('validates log volume and scheduling bounds', () => {
    for (const settings of [
      { API_OBSERVABILITY_LOG_INTERVAL_MS: 1 },
      { API_OBSERVABILITY_REQUEST_LOG_LIMIT: 101 },
      { API_OBSERVABILITY_SLOW_MS: 0 },
    ]) {
      expect(
        () =>
          new ApiObservabilityService(
            new ConfigService(settings),
            {} as PrismaService,
            {} as ApiCapacityService,
          ),
      ).toThrow();
    }
  });
  it('labels percentile bounds and refuses thin samples or overflow as exact latency', () => {
    const res = response();
    service.observe(req(), res, () => {});
    res.emit('finish');
    const metrics = service.snapshot().total;
    expect(metrics.p95.status).toBe('insufficient');
    metrics.latencyCount = 1000;
    metrics.buckets.fill(0);
    metrics.buckets[1] = 950;
    metrics.buckets[11] = 50;
    expect(latencyTail(metrics, 0.95, 100)).toEqual({
      status: 'bucket-bound',
      upperBoundMs: 25,
    });
    expect(latencyTail(metrics, 0.99, 1000)).toEqual({
      status: 'overflow',
      upperBoundMs: null,
    });
  });
  it('periodically exports aggregates and stops its timer on shutdown', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const periodic = new ApiObservabilityService(
      new ConfigService({ API_OBSERVABILITY_LOG_INTERVAL_MS: 10000 }),
      {
        databasePoolSnapshot: () => ({ total: 1 }),
      } as unknown as PrismaService,
      {
        snapshot: () => ({ active: { total: 0 } }),
      } as unknown as ApiCapacityService,
    );
    try {
      vi.advanceTimersByTime(10000);
      expect(logs).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logs.mock.calls[0][0] as string).event).toBe(
        'api.metrics',
      );
      periodic.onModuleDestroy();
      vi.advanceTimersByTime(20000);
      expect(logs).toHaveBeenCalledTimes(1);
    } finally {
      periodic.onModuleDestroy();
      vi.useRealTimers();
    }
  });
});
