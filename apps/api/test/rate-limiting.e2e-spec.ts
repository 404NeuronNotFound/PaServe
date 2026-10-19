import { Test } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RATE_LIMIT_POLICY } from '../src/common/rate-limiting/rate-limit.policy.js';
import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { REFRESH_COOKIE } from '../src/modules/auth/tokens.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

const id = '10000000-0000-4000-8000-000000000001';
const payload = {
  requestId: id,
  mode: 'TAKEOUT',
  items: [{ productId: id, quantity: 1, variantIds: [], addOnIds: [] }],
};

describe('rate limiting admission and recovery', () => {
  let app: NestExpressApplication;
  const create = vi.fn();
  const refresh = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(OrdersService)
      .useValue({ create })
      .overrideProvider(AuthService)
      .useValue({
        refresh,
        currentUser: vi.fn().mockRejectedValue(new UnauthorizedException()),
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRateLimits(app);
    configureTrustedProxy(app, '');
    create.mockReset().mockResolvedValue({
      order: { id, qrTokenExpiresAt: null },
      trackingToken: 'unused',
    });
    refresh.mockReset().mockRejectedValue(new UnauthorizedException());
  });
  const post = (shop = 'cafe') =>
    request(app.getHttpServer()).post(`/api/v1/menu/${shop}/orders`);

  it('keeps critical registered routes explicitly covered by the intended policy', () => {
    const routes = new Map<string, string | undefined>();
    const reflector = app.get(Reflector);
    for (const { metatype } of app.get(DiscoveryService).getControllers()) {
      if (!metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype);
      if (typeof base !== 'string') continue;
      for (const key of Object.getOwnPropertyNames(metatype.prototype)) {
        const handler = metatype.prototype[key];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const route =
          `${base}/${Reflect.getMetadata(PATH_METADATA, handler) ?? ''}`.replace(
            /\/+$/u,
            '',
          );
        routes.set(
          `${RequestMethod[method]} ${route}`,
          reflector.getAllAndOverride(RATE_LIMIT_POLICY, [handler, metatype]),
        );
      }
    }
    const expected = {
      'POST auth/register': 'register',
      'POST auth/login': 'login',
      'POST auth/refresh': 'refresh',
      'POST auth/logout': 'logout',
      'GET auth/me': 'session',
      'POST menu/:shopSlug/orders': 'orderCreate',
      'POST menu/:shopSlug/products/:productId/quote': 'quote',
      'POST menu/:shopSlug/products/:productId/add-ons/quote': 'quote',
      'POST menu/:shopSlug/orders/:orderId/tracking-session': 'receiptProof',
      'GET menu/:shopSlug/orders/:orderId/tracking-link': 'receiptProof',
      'GET menu/:shopSlug/orders/:orderId/status': 'receiptRead',
      'GET menu/:shopSlug/orders/:orderId/events': 'stream',
      'GET menu/:shopSlug/availability-events': 'stream',
      'GET menu/:shopSlug/table/:tableCode': 'tableContext',
      'POST shops/:shopId/orders/scan-qr': 'staffVerification',
      'POST shops/:shopId/orders/:orderId/verify-qr': 'staffVerification',
      'POST shops/:shopId/orders/lookup-number': 'staffVerification',
      'POST shops/:shopId/orders/cash-payment/lookup-number':
        'staffVerification',
      'POST shops/:shopId/orders/:orderId/confirm': 'staffVerification',
      'POST shops/:shopId/orders/:orderId/reject': 'staffVerification',
      'POST shops/:shopId/staff/invitations': 'invitationCreate',
      'POST staff-invitations/:shopId/preview': 'invitationProof',
      'POST staff-invitations/:shopId/accept': 'invitationProof',
      'POST shops/:shopId/products/:productId/image': 'upload',
      'POST shops/:shopId/logo': 'upload',
      'POST shops/:shopId/banner': 'upload',
      'POST shops': 'shopCreate',
      'GET shops/:shopId/reports/daily-sales': 'reports',
    };
    for (const [route, policy] of Object.entries(expected))
      expect(routes.get(route), route).toBe(policy);
    expect(routes.get('GET')).toBeUndefined();
  });
  it.each([
    ['/api/v1/menu/cafe/orders/' + id + '/tracking-session', 'post', 30, 401],
    ['/api/v1/menu/cafe/orders/' + id + '/tracking-link', 'get', 30, 401],
    ['/api/v1/menu/cafe/orders/' + id + '/events', 'get', 60, 401],
    ['/api/v1/menu/cafe/products/' + id + '/quote', 'post', 120, 400],
    ['/api/v1/menu/cafe/products/' + id + '/add-ons/quote', 'post', 120, 400],
    ['/api/v1/auth/logout', 'post', 30, 403],
  ] as const)(
    'bounds repeated attempts on %s',
    async (path, method, limit, status) => {
      for (let index = 0; index < limit; index++)
        await request(app.getHttpServer())
          [method](path)
          .send({})
          .expect(status);
      await request(app.getHttpServer())[method](path).send({}).expect(429);
    },
  );
  it('allows the limit including idempotent retries, then rejects without another service call', async () => {
    for (let index = 0; index < 30; index++)
      await post().send(payload).expect(201);
    const response = await post().send(payload).expect(429);
    expect(create).toHaveBeenCalledTimes(30);
    expect(response.body).toEqual({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait before trying again.',
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('counts malformed orders before DTO validation or transactions', async () => {
    for (let index = 0; index < 30; index++) await post().send({}).expect(400);
    await post().send(payload).expect(429);
    expect(create).not.toHaveBeenCalled();
  });
  it('does not let changed IDs, tokens, headers or untrusted forwarded IPs reset a bucket', async () => {
    for (let index = 0; index < 30; index++) {
      await post()
        .set('X-Forwarded-For', `192.0.2.${index + 1}`)
        .set('X-Shop-Id', `shop-${index}`)
        .set('Authorization', `Bearer fabricated-${index}`)
        .send({
          ...payload,
          requestId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          token: `token-${index}`,
        })
        .expect(400);
    }
    await post()
      .set('X-Forwarded-For', '198.51.100.1')
      .send(payload)
      .expect(429);
    expect(create).not.toHaveBeenCalled();
  });
  it('isolates shops while the per-IP aggregate prevents unlimited slug rotation', async () => {
    for (let index = 0; index < 30; index++)
      await post().send(payload).expect(201);
    await post().send(payload).expect(429);
    await post('other-cafe').send(payload).expect(201);
    resetRateLimits(app);
    for (let index = 0; index < 120; index++)
      await post(`shop-${index}`).send(payload).expect(201);
    await post('fresh-shop').send(payload).expect(429);
    expect(create).toHaveBeenCalledTimes(151);
  });
  it('distinguishes trusted client IPs and groups IPv6 addresses within a /64', async () => {
    configureTrustedProxy(app, '127.0.0.0/8,::1/128');
    for (let index = 0; index < 30; index++)
      await post()
        .set('X-Forwarded-For', '192.0.2.10')
        .send(payload)
        .expect(201);
    await post().set('X-Forwarded-For', '192.0.2.10').send(payload).expect(429);
    await post()
      .set('X-Forwarded-For', '::ffff:192.0.2.10')
      .send(payload)
      .expect(429);
    await post().set('X-Forwarded-For', '192.0.2.11').send(payload).expect(201);
    resetRateLimits(app);
    for (let index = 0; index < 30; index++)
      await post()
        .set('X-Forwarded-For', `2001:db8:1:2::${index + 1}`)
        .send(payload)
        .expect(201);
    await post()
      .set('X-Forwarded-For', '2001:db8:1:2::ffff')
      .send(payload)
      .expect(429);
    await post()
      .set('X-Forwarded-For', '2001:db8:1:3::1')
      .send(payload)
      .expect(201);
  });
  it('trusts the nearest untrusted hop rather than an attacker-prepended forwarded IP', async () => {
    configureTrustedProxy(app, '127.0.0.0/8,::1/128');
    for (let index = 0; index < 30; index++)
      await post()
        .set('X-Forwarded-For', `198.51.100.${index + 1}, 192.0.2.10`)
        .send(payload)
        .expect(201);
    await post()
      .set('X-Forwarded-For', '198.51.100.200, 192.0.2.10')
      .send(payload)
      .expect(429);
  });
  it('admits only the budget under concurrent submissions', async () => {
    const results = await Promise.all(
      Array.from({ length: 35 }, () => post().send(payload)),
    );
    expect(results.filter((response) => response.status === 201)).toHaveLength(
      30,
    );
    expect(results.filter((response) => response.status === 429)).toHaveLength(
      5,
    );
    expect(create).toHaveBeenCalledTimes(30);
  });
  it('recovers when old hits expire and rejected retries do not extend the window', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let index = 0; index < 30; index++)
      await post().send(payload).expect(201);
    now += 59_000;
    const blocked = await post().send(payload).expect(429);
    expect(blocked.headers['retry-after']).toBe('1');
    now += 1_001;
    await post().send(payload).expect(201);
  });
  it('counts invalid refresh credentials before performing more session work', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-PaServe-Client', 'web')
        .set('Cookie', `${REFRESH_COOKIE}=invalid`)
        .send({});
    for (let index = 0; index < 30; index++) await attempt().expect(401);
    await attempt().expect(429);
    expect(refresh).toHaveBeenCalledTimes(30);
  });
  it('shares staff verification budgets across QR aliases and order IDs', async () => {
    const paths = [
      `/shops/${id}/orders/scan-qr`,
      `/shops/${id}/orders/lookup-number`,
      `/shops/${id}/orders/${id}/verify-qr`,
    ];
    for (let index = 0; index < 120; index++)
      await request(app.getHttpServer())
        .post(`/api/v1${paths[index % paths.length]}`)
        .send({})
        .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1${paths[0]}`)
      .send({})
      .expect(429);
  });
  it('rate limits uploads before authentication or multipart image decoding', async () => {
    const paths = [
      `/shops/${id}/logo`,
      `/shops/${id}/banner`,
      `/shops/${id}/products/${id}/image`,
    ];
    for (let index = 0; index < 20; index++)
      await request(app.getHttpServer())
        .post(`/api/v1${paths[index % paths.length]}`)
        .send({})
        .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1${paths[0]}`)
      .attach('file', Buffer.from('invalid-image'), 'bad.png')
      .expect(429);
  });
  it('stores opaque keys instead of credentials or request data', async () => {
    await post()
      .set('Authorization', 'Bearer private-secret')
      .send({})
      .expect(400);
    const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    const keys = [...storage.storage.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify(keys)).not.toContain('private-secret');
  });
});
