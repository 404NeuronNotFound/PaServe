import {
  Controller,
  Get,
  Logger,
  Post,
  UseGuards,
  type CanActivate,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ApiObservabilityService } from '../src/common/observability/api-observability.service.js';
import { DatabaseQueryMetrics } from '../src/database/database-query.metrics.js';
import { RateLimit } from '../src/common/rate-limiting/rate-limit.policy.js';
import { externalServiceMetrics } from '../src/common/observability/external-service.metrics.js';

const database = new DatabaseQueryMetrics();
class Denied implements CanActivate {
  canActivate() {
    return false;
  }
}
@Controller('observability-fixture')
class ObservationController {
  @Get('external') async external() {
    await externalServiceMetrics.observe('storage-upload', async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { error: null };
    });
    return { ok: true };
  }
  @Get('items/:id') read() {
    return { ok: true };
  }
  @Post('failure') failure() {
    throw new Error('postgres://private:password@host secret SQL token');
  }
  @Get('denied') @UseGuards(Denied) denied() {
    return { ok: true };
  }
  @Get('analytics') @RateLimit('reports') async analytics() {
    await database.observe(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return 1;
    });
    return { ok: true };
  }
  @Get('slow') async slow() {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ok: true };
  }
}

describe('API request observability', () => {
  let app: INestApplication;
  let metrics: ApiObservabilityService;
  let logs: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ObservationController],
    })
      .overrideProvider(PrismaService)
      .useValue({ databasePoolSnapshot: () => ({ total: 0, waiting: 0 }) })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          API_OBSERVABILITY_SLOW_MS: 100,
          API_OBSERVABILITY_REQUEST_LOG_LIMIT: 100,
          JWT_ACCESS_SECRET: 'test-only-access-secret-at-least-32-characters',
          JWT_REFRESH_SECRET: 'test-only-refresh-secret-at-least-32-characters',
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    metrics = app.get(ApiObservabilityService);
    logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterAll(async () => {
    logs.mockRestore();
    await app.close();
  });

  it('generates unique IDs and records templates, 404s and guard rejections', async () => {
    const before = metrics.snapshot().total.count;
    const first = await request(app.getHttpServer())
      .get('/api/v1/observability-fixture/items/private-id')
      .set('X-Request-ID', 'forged-correlation-secret')
      .query({ trackingToken: 'secret' });
    const second = await request(app.getHttpServer()).get(
      '/api/v1/observability-fixture/items/another-id',
    );
    expect(first.status).toBe(200);
    expect(first.headers['x-request-id']).toMatch(/^[\da-f-]{36}$/);
    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
    await request(app.getHttpServer())
      .get('/api/v1/does-not-exist/private-token')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/observability-fixture/denied')
      .expect(403);
    const snapshot = metrics.snapshot();
    expect(snapshot.total.count - before).toBe(4);
    expect(snapshot.inFlight).toBe(0);
    expect(
      snapshot.routes.some((row) => row.route.includes('/items/:id')),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private-id|private-token|another-id|trackingToken|forged-correlation/,
    );
  });
  it('correlates redacted unexpected errors with the response request ID', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/observability-fixture/failure')
      .send({ password: 'sensitive-password' })
      .expect(500);
    const records = logs.mock.calls.map((call) => String(call[0]));
    expect(
      records.some((line) => line.includes(response.headers['x-request-id'])),
    ).toBe(true);
    const record = records
      .map((line) => JSON.parse(line))
      .find((line) => line.requestId === response.headers['x-request-id']);
    expect(record.failure).toBe('server-error');
    expect(JSON.stringify(records)).not.toMatch(
      /sensitive-password|postgres:|secret SQL|private:password/,
    );
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
  });
  it('carries database timing into slow request diagnostics without retaining SQL', async () => {
    // Use slow threshold for a deterministic diagnostic after database work.
    await request(app.getHttpServer())
      .get('/api/v1/observability-fixture/slow')
      .expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/v1/observability-fixture/analytics')
      .expect(200);
    expect(database.snapshot().analytics.count).toBeGreaterThan(0);
    const record = logs.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((line) => line.requestId === response.headers['x-request-id']);
    expect(record.database.count).toBe(1);
    expect(record.database.totalMs).toBeGreaterThanOrEqual(100);
    expect(
      metrics.snapshot().routes.some((row) => row.route.includes('/analytics')),
    ).toBe(true);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
  it('correlates separate external-operation metrics without database attribution', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/observability-fixture/external')
      .expect(200);
    const record = logs.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((line) => line.requestId === response.headers['x-request-id']);
    expect(record.external['storage-upload'].count).toBe(1);
    expect(record.external['storage-upload'].totalMs).toBeGreaterThanOrEqual(
      100,
    );
    expect(record.database.count).toBe(0);
    expect(
      metrics.snapshot().external.operations['storage-upload'].count,
    ).toBeGreaterThan(0);
  });
});
