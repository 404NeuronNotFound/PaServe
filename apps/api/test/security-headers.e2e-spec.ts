import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { configureSecurityHeaders } from '../src/common/http/security-headers.js';
import { configureRequestBody } from '../src/common/http/request-body.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

describe('API security headers', () => {
  let app: NestExpressApplication;
  const query = vi.fn();
  async function start(production: boolean) {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: query })
      .compile();
    const api = module.createNestApplication<NestExpressApplication>();
    configureSecurityHeaders(api, production);
    configureRequestBody(api);
    api.enableCors({ origin: 'https://menu.example.test', credentials: true });
    api.setGlobalPrefix('api/v1');
    await api.init();
    return api;
  }
  beforeAll(async () => {
    app = await start(true);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    query.mockReset().mockResolvedValue([{ healthy: 1 }]);
  });
  function check(headers: Record<string, string>) {
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers['content-security-policy']).not.toMatch(
      /unsafe-inline|unsafe-eval|upgrade-insecure/,
    );
    expect(headers['strict-transport-security']).toBe('max-age=31536000');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(headers['x-powered-by']).toBeUndefined();
  }
  it.each([
    ['/api/v1', 200],
    ['/api/v1/auth/me', 401],
    ['/api/v1/not-found', 404],
  ] as const)('protects %s responses', async (path, status) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .expect(status);
    check(response.headers);
  });
  it('protects DTO validation and origin-denial responses', async () => {
    check(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({})
          .expect(400)
      ).headers,
    );
    check(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({})
          .expect(403)
      ).headers,
    );
  });
  it('protects body-parser rejections before route handlers', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ oversized: 'x'.repeat(1_100_000) })
      .expect(413);
    check(response.headers);
  });
  it('preserves CSP, security headers and Retry-After on rate-limit errors', async () => {
    for (let n = 0; n < 5; n++)
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({})
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
    check(response.headers);
  });
  it('protects unhandled failures without exposing error details', async () => {
    query.mockRejectedValue(new Error('private database details'));
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain(
      'private database details',
    );
    check(response.headers);
  });
  it('preserves credentialed cross-origin preflight responses', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/auth/refresh')
      .set('Origin', 'https://menu.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://menu.example.test',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    check(response.headers);
  });
  it('does not enable HSTS in local HTTP development, including forged proxy hints', async () => {
    const local = await start(false);
    try {
      const response = await request(local.getHttpServer())
        .get('/api/v1')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      expect(response.headers['strict-transport-security']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).not.toContain(
        'upgrade-insecure-requests',
      );
    } finally {
      await local.close();
    }
  });
});
