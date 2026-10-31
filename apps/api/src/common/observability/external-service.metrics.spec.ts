import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ExternalServiceMetrics,
  externalCounters,
  externalServiceMetrics,
} from './external-service.metrics.js';
import {
  apiObservation,
  type ApiObservation,
} from './api-observation.context.js';
import { boundedFetch } from '../http/request-context.js';

function observation(): ApiObservation {
  return {
    requestId: 'fixture',
    database: { count: 0, failures: 0, totalMs: 0, maxMs: 0 },
    external: {
      'http-headers': externalCounters(),
      'turnstile-verification': externalCounters(),
      'storage-upload': externalCounters(),
      'storage-remove': externalCounters(),
    },
  };
}

describe('external service metrics', () => {
  it('isolates concurrent requests, counts returned SDK errors and preserves thrown errors', async () => {
    const metrics = new ExternalServiceMetrics(),
      first = observation(),
      second = observation();
    const error = new Error('secret-token-and-payment-data');
    await Promise.all([
      apiObservation.run(first, async () => {
        await metrics.observe(
          'storage-upload',
          async () => ({ error: 'private' }),
          (value) => Boolean(value.error),
        );
        await expect(
          metrics.observe('storage-remove', async () => {
            throw error;
          }),
        ).rejects.toBe(error);
      }),
      apiObservation.run(second, () =>
        metrics.observe('storage-upload', async () => ({ error: null })),
      ),
    ]);
    expect(first.external['storage-upload'].failures).toBe(1);
    expect(first.external['storage-remove'].failures).toBe(1);
    expect(second.external['storage-upload'].failures).toBe(0);
    const result = metrics.snapshot();
    expect(result.operations['storage-upload'].count).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/secret|private|payment/);
    for (const value of Object.values(result.operations))
      expect(value.buckets.reduce((n, count) => n + count, 0)).toBe(
        value.count,
      );
    result.operations['storage-upload'].buckets[0] = -1;
    expect(
      metrics.snapshot().operations['storage-upload'].buckets[0],
    ).toBeGreaterThanOrEqual(0);
  });

  describe('real loopback fetch boundaries', () => {
    let server: Server, base: string;
    beforeAll(async () => {
      server = createServer((req, res) => {
        res.setHeader('Connection', 'close');
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/unavailable') res.statusCode = 503;
        res.writeHead(res.statusCode);
        res.flushHeaders();
        const timer = setTimeout(() => res.end('{"success":true}'), 80);
        res.once('close', () => clearTimeout(timer));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('separates header wait from complete body/operation duration', async () => {
      const metrics = new ExternalServiceMetrics(),
        context = observation();
      await apiObservation.run(context, () =>
        metrics.observe('turnstile-verification', async () => {
          const reply = await boundedFetch(base + '/ok?token=private');
          return reply.json();
        }),
      );
      const header = context.external['http-headers'],
        operation = context.external['turnstile-verification'];
      expect(header.count).toBe(1);
      expect(operation.count).toBe(1);
      expect(operation.totalMs - header.totalMs).toBeGreaterThan(35);
      expect(JSON.stringify(context.external)).not.toContain(base);
    });

    it('counts non-2xx and abort failures without recording destinations or errors', async () => {
      const before =
        externalServiceMetrics.snapshot().operations['http-headers'];
      const response = await boundedFetch(base + '/unavailable');
      await response.text();
      const after =
        externalServiceMetrics.snapshot().operations['http-headers'];
      expect(after.failures - before.failures).toBe(1);
      const controller = new AbortController(),
        metrics = new ExternalServiceMetrics();
      const pending = metrics.observe('turnstile-verification', async () => {
        const reply = await boundedFetch(base + '/body', {
          signal: controller.signal,
        });
        controller.abort();
        return reply.json();
      });
      await expect(pending).rejects.toBeDefined();
      expect(
        metrics.snapshot().operations['turnstile-verification'].failures,
      ).toBe(1);
    });
  });
});
