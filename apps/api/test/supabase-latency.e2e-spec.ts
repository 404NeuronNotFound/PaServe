import { Controller, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ShopLogoStorage } from '../src/modules/shops/shop-logo.storage.js';
import { ShopBannerStorage } from '../src/modules/shops/shop-banner.storage.js';
import { ProductImageStorage } from '../src/modules/products/product-image.storage.js';
import { ApiCapacityService } from '../src/common/load-shedding/api-capacity.service.js';
import { RequestDeadlineService } from '../src/common/http/request-deadline.service.js';
import { RateLimit } from '../src/common/rate-limiting/rate-limit.policy.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';

type Kind = 'logo' | 'banner' | 'product';
type Mode = 'delayed-success' | 'stalled-headers' | 'stalled-body' | 'reset';
const kinds: Kind[] = ['logo', 'banner', 'product'];
const shop = '10000000-0000-4000-8000-000000000001';
const product = '20000000-0000-4000-8000-000000000002';
let config: ConfigService;
function storage(kind: Kind) {
  const buffer = Buffer.from('disposable storage transport fixture');
  switch (kind) {
    case 'logo':
      return new ShopLogoStorage(config).upload(shop, buffer);
    case 'banner':
      return new ShopBannerStorage(config).upload(shop, buffer);
    case 'product':
      return new ProductImageStorage(config).upload(shop, product, buffer);
  }
}

@Controller('sdk-latency')
@RateLimit('upload')
class SdkLatencyController {
  @Post(':kind')
  upload(@Param('kind') kind: Kind) {
    return storage(kind);
  }
}

describe('real Supabase SDK storage under local network faults', () => {
  let app: NestExpressApplication, upstream: Server;
  let mode: Mode = 'delayed-success';
  let uploads = 0,
    deletes = 0,
    aborted = 0;
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const rows: {
    kind: string;
    scenario: string;
    elapsedMs: number;
    pass: boolean;
  }[] = [];
  const until = async (check: () => boolean) => {
    const end = Date.now() + 3000;
    while (!check()) {
      if (Date.now() >= end) throw new Error('SDK request did not settle');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  // Three simulated legitimate clients behind this loopback-only fixture proxy.
  // Keep the real upload rate limits enabled without resetting their budgets.
  const post = (kind: Kind) =>
    request(app.getHttpServer())
      .post(`/api/v1/sdk-latency/${kind}`)
      .set('X-Forwarded-For', `192.0.2.${kinds.indexOf(kind) + 1}`);
  const record = (kind: string, scenario: string, start: number) =>
    rows.push({
      kind,
      scenario,
      elapsedMs: Math.round(performance.now() - start),
      pass: true,
    });

  beforeAll(async () => {
    upstream = createServer((incoming, response) => {
      incoming.resume();
      response.on('close', () => {
        if (!response.writableEnded) aborted++;
      });
      // Only the Supabase storage API is implemented; no provider/account access.
      if (!incoming.url?.startsWith('/storage/v1/object/paserve-assets')) {
        response.writeHead(404).end();
        return;
      }
      if (incoming.method === 'DELETE') {
        deletes++;
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end('[]');
        return;
      }
      if (incoming.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      uploads++;
      if (mode === 'reset') {
        incoming.socket.destroy();
        return;
      }
      if (mode === 'stalled-headers') return;
      if (mode === 'stalled-body') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{');
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!response.destroyed)
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(
              JSON.stringify({
                Key: incoming.url?.slice('/storage/v1/object/'.length),
                Id: product,
              }),
            );
      }, 40);
      timers.add(timer);
    });
    upstream.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    config = new ConfigService({
      SUPABASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-only-non-provider-key',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SdkLatencyController],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RequestDeadlineService)
      .useValue(
        new RequestDeadlineService(
          new ConfigService({ API_UPLOAD_TIMEOUT_MS: '400' }),
        ),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    configureTrustedProxy(app, '127.0.0.0/8');
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    await until(
      () => app.get(ApiCapacityService).snapshot().active.total === 0,
    );
  });
  afterAll(async () => {
    await app?.close();
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    const report = fileURLToPath(
      new URL(
        '../../../artifacts/performance/request-timeouts-supabase-local.json',
        import.meta.url,
      ),
    );
    await mkdir(dirname(report), { recursive: true });
    await writeFile(
      report,
      JSON.stringify(
        {
          pass: rows.length === 16,
          scope: 'real-sdk-local-http-no-live-provider',
          requestDeadlineMs: 400,
          dependencyDeadlineMs: 10000,
          checks: rows,
        },
        null,
        2,
      ) + '\n',
    );
  });

  it.each(kinds)(
    '%s accepts a delayed successful SDK response',
    async (kind) => {
      mode = 'delayed-success';
      const start = performance.now(),
        before = uploads;
      const reply = await post(kind);
      expect(reply.status).toBe(201);
      expect(reply.body.storagePath).toContain(`shops/${shop}/`);
      expect(uploads - before).toBe(1);
      expect(performance.now() - start).toBeGreaterThanOrEqual(35);
      record(kind, 'delayed-success', start);
    },
  );

  for (const fault of ['stalled-headers', 'stalled-body'] as const) {
    it.each(kinds)(
      `%s aborts ${fault}, releases capacity and recovers`,
      async (kind) => {
        mode = fault;
        const start = performance.now(),
          before = uploads,
          beforeAbort = aborted,
          beforeDeletes = deletes;
        const reply = await post(kind);
        expect(reply.status).toBe(504);
        expect(reply.body.code).toBe('REQUEST_TIMEOUT');
        expect(reply.headers['cache-control']).toBe('no-store');
        await until(() => aborted > beforeAbort);
        await until(
          () => app.get(ApiCapacityService).snapshot().active.total === 0,
        );
        expect(uploads - before).toBe(1);
        expect(deletes).toBe(beforeDeletes); // Aborted context cannot start cleanup network calls.
        expect(performance.now() - start).toBeLessThan(3000);
        mode = 'delayed-success';
        await post(kind).expect(201);
        record(kind, fault, start);
      },
    );
  }

  it.each(kinds)(
    '%s maps a reset SDK connection to recoverable 503 without replay',
    async (kind) => {
      mode = 'reset';
      const start = performance.now(),
        before = uploads,
        beforeDeletes = deletes;
      const reply = await post(kind);
      expect(reply.status).toBe(503);
      expect(reply.body.code).toBe(
        kind === 'logo'
          ? 'SHOP_LOGO_STORAGE_UNAVAILABLE'
          : kind === 'banner'
            ? 'SHOP_BANNER_STORAGE_UNAVAILABLE'
            : 'PRODUCT_STORAGE_UNAVAILABLE',
      );
      expect(uploads - before).toBe(1);
      expect(deletes - beforeDeletes).toBe(1);
      mode = 'delayed-success';
      await post(kind).expect(201);
      record(kind, 'connection-reset', start);
    },
  );

  it('cancels a real SDK upload when its API client disconnects', async () => {
    mode = 'stalled-headers';
    const start = performance.now(),
      before = uploads,
      beforeAbort = aborted;
    const socket = httpRequest({
      host: '127.0.0.1',
      port: (app.getHttpServer().address() as AddressInfo).port,
      method: 'POST',
      path: '/api/v1/sdk-latency/logo',
      headers: { 'X-Forwarded-For': '192.0.2.4' },
    });
    socket.on('error', () => {});
    socket.end();
    await until(() => uploads > before);
    socket.destroy();
    await until(() => aborted > beforeAbort);
    expect(uploads - before).toBe(1);
    record('logo', 'client-disconnect', start);
  });

  it('enforces the actual 10-second dependency timeout through each SDK without a request context', async () => {
    mode = 'stalled-headers';
    const before = uploads,
      beforeDeletes = deletes,
      beforeAbort = aborted;
    await Promise.all(
      kinds.map(async (kind) => {
        const start = performance.now();
        await expect(storage(kind)).rejects.toMatchObject({ status: 503 });
        expect(performance.now() - start).toBeGreaterThanOrEqual(9500);
        expect(performance.now() - start).toBeLessThan(18000);
        record(kind, 'dependency-timeout-without-context', start);
      }),
    );
    expect(uploads - before).toBe(3);
    expect(deletes - beforeDeletes).toBe(3);
    await until(() => aborted - beforeAbort >= 3);
  }, 25000);
});
