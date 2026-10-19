import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { REFRESH_COOKIE } from '../src/modules/auth/tokens.service.js';
import { ShopMembersService } from '../src/modules/shop-members/shop-members.service.js';
import { PublicProductService } from '../src/modules/products/public-product.service.js';
import { PublicMenuRepository } from '../src/modules/categories/public-menu.repository.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { CustomerOrderStatusService } from '../src/modules/orders/customer-order-status.service.js';
import { OrderQrService } from '../src/modules/orders/order-qr.service.js';
import { CompletedSalesService } from '../src/modules/orders/completed-sales.service.js';
import { NewOrderEventsService } from '../src/modules/orders/new-order-events.service.js';
import { TableContextService } from '../src/modules/tables/table-context.service.js';
import { configureTrustedProxy } from '../src/common/http/trusted-proxy.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

const uuid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shopId = uuid(1),
  productId = uuid(2);
const selection = { variantIds: [], addOnIds: [], quantity: 1 };
const checkout = (n: number) => ({
  requestId: uuid(100 + n),
  mode: 'TAKEOUT',
  items: [{ ...selection, productId }],
});

// An admission workload, not a database throughput or end-to-end business test.
// Real controllers, DTOs, rate guard and auth/role guards run. Domain/storage,
// authenticated identities and stream transport are deterministic fixtures.
describe('restaurant traffic sharing one client IP', () => {
  let app: NestExpressApplication;
  let now: number;
  const create = vi.fn(),
    quote = vi.fn(),
    scan = vi.fn(),
    report = vi.fn(),
    refresh = vi.fn();
  const currentUser = async (token: string) => ({
    id: uuid(token === 'owner' ? 10 : 11 + Number(token.split('-')[1] ?? 0)),
    memberships: [],
  });
  const session = () => ({
    refreshToken: 'session-fixture',
    expiresAt: new Date(now + 600_000),
    response: { accessToken: 'session-fixture', user: { id: uuid(10) } },
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { findFirst: async () => ({ id: shopId }) } })
      .overrideProvider(AuthService)
      .useValue({ currentUser, login: async () => session(), refresh })
      .overrideProvider(ShopMembersService)
      .useValue({
        requireMembership: async (userId: string) => ({
          userId,
          shopId,
          role: userId === uuid(10) ? 'OWNER' : 'CASHIER',
        }),
      })
      .overrideProvider(OrdersService)
      .useValue({ create })
      .overrideProvider(PublicProductService)
      .useValue({
        details: async () => ({ product: { id: productId } }),
        quote,
      })
      .overrideProvider(PublicMenuRepository)
      .useValue({
        read: async () => ({
          name: 'Cafe',
          slug: 'cafe',
          categories: [],
          products: [],
        }),
      })
      .overrideProvider(CustomerOrderStatusService)
      .useValue({
        read: async (_slug: string, orderId: string) => ({
          order: { id: orderId, shopId },
        }),
      })
      .overrideProvider(OrderQrService)
      .useValue({ scan })
      .overrideProvider(CompletedSalesService)
      .useValue({
        daily: report,
        topProducts: report,
        peakHours: report,
        averagePrepTime: report,
        salesTrends: report,
        summary: report,
      })
      .overrideProvider(NewOrderEventsService)
      .useValue({
        relay: async (
          _topic: unknown,
          _events: unknown,
          _scope: unknown,
          _recheck: unknown,
          response: Response,
        ) => response.status(200).end(),
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
    vi.clearAllMocks();
    resetRateLimits(app);
    configureTrustedProxy(app, '');
    now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    create.mockImplementation(
      async (_slug: string, dto: { requestId: string }) => ({
        order: { id: dto.requestId, qrTokenExpiresAt: null },
        trackingToken: 'unused',
      }),
    );
    quote.mockResolvedValue({ productId, quantity: 1, totalPrice: '1.00' });
    scan.mockResolvedValue({ verified: true });
    report.mockResolvedValue({});
    refresh.mockImplementation(async () => session());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const http = () => request(app.getHttpServer());
  const receipt = (n: number, suffix: string) =>
    `/api/v1/menu/cafe/orders/${uuid(100 + n)}/${suffix}`;
  const proof = () =>
    `${Buffer.from(JSON.stringify({ exp: now + 600_000 })).toString('base64url')}.fixture`;
  const quotes = () =>
    http()
      .post(`/api/v1/menu/cafe/products/${productId}/quote`)
      .send(selection);
  const orders = (n: number) =>
    http().post('/api/v1/menu/cafe/orders').send(checkout(n));
  const verify = (staff = 0) =>
    http()
      .post(`/api/v1/shops/${shopId}/orders/scan-qr`)
      .set('Authorization', `Bearer cashier-${staff}`)
      .send({ qrToken: 'receipt-fixture' });

  it('admits a mixed minute of 20 customers, four staff and reporting on one shared IP without 429', async () => {
    for (let staff = 0; staff < 5; staff++)
      await http()
        .post('/api/v1/auth/login')
        .set('X-PaServe-Client', 'web')
        .send({
          email: `staff${staff}@example.com`,
          password: 'valid-passphrase',
        })
        .expect(200);
    const tableToken = app.get(TableContextService).issue('cafe', 'T12');
    for (let customer = 0; customer < 20; customer++) {
      await http().get('/api/v1/menu/cafe').expect(200);
      await http().get('/api/v1/menu/cafe/availability-events').expect(200);
      // Menu subscription before checkout, then receipt subscription after it.
      for (let item = 0; item < 4; item++) {
        await http().get(`/api/v1/menu/cafe/products/${productId}`).expect(200);
        await quotes().expect(201);
      }
      const body = checkout(customer);
      await http()
        .post('/api/v1/menu/cafe/orders')
        .send(
          customer % 5 === 0
            ? body
            : { ...body, mode: 'DINE_IN', tableCode: 'T12', tableToken },
        )
        .expect(201);
      await http()
        .post(receipt(customer, 'tracking-session'))
        .set('Authorization', `Bearer ${proof()}`)
        .expect(201);
      await http()
        .get(receipt(customer, 'events'))
        .set('Authorization', 'Bearer receipt-fixture')
        .expect(200);
    }
    // 15-second polling reflects the implemented receipt/dashboard refresh cycle.
    const reports = [
      'daily-sales',
      'top-products',
      'peak-hours',
      'average-prep-time',
      'sales-trends',
      'completed-sales',
    ];
    for (let tick = 0; tick < 4; tick++) {
      now += tick === 0 ? 0 : 15_000;
      for (let customer = 0; customer < 20; customer++)
        await http()
          .get(receipt(customer, 'status'))
          .set('Authorization', 'Bearer receipt-fixture')
          .expect(200);
      for (let staff = 0; staff < 4; staff++)
        for (let order = 0; order < 5; order++) await verify(staff).expect(200);
      for (const name of reports)
        await http()
          .get(`/api/v1/shops/${shopId}/reports/${name}`)
          .set('Authorization', 'Bearer owner')
          .expect(200);
      // A simultaneous network recovery must not make receipt polling/QR work fail.
      if (tick === 2)
        for (let customer = 0; customer < 20; customer++)
          await http()
            .get(receipt(customer, 'events'))
            .set('Authorization', 'Bearer receipt-fixture')
            .expect(200);
    }
    for (let staff = 0; staff < 5; staff++)
      await http()
        .post('/api/v1/auth/refresh')
        .set('X-PaServe-Client', 'web')
        .set('Cookie', `${REFRESH_COOKIE}=session-${staff}`)
        .send({})
        .expect(200);
    expect(create).toHaveBeenCalledTimes(20);
    expect(quote).toHaveBeenCalledTimes(80);
    expect(scan).toHaveBeenCalledTimes(80);
    expect(report).toHaveBeenCalledTimes(24);
    expect(refresh).toHaveBeenCalledTimes(5);
  });
  it('keeps checkout, polling, staff scans and reports working when quote abuse exhausts its budget', async () => {
    for (let index = 0; index < 120; index++) await quotes().expect(201);
    await quotes().expect(429);
    await orders(1).expect(201);
    await http()
      .get(receipt(1, 'status'))
      .set('Authorization', 'Bearer receipt-fixture')
      .expect(200);
    await verify().expect(200);
    await http()
      .get(`/api/v1/shops/${shopId}/reports/daily-sales`)
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(quote).toHaveBeenCalledTimes(120);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('admits checkout from another trusted client IP while one client is throttled', async () => {
    configureTrustedProxy(app, '127.0.0.0/8,::1/128');
    const submit = (ip: string, n: number) =>
      http()
        .post('/api/v1/menu/cafe/orders')
        .set('X-Forwarded-For', ip)
        .send(checkout(n));
    for (let index = 0; index < 30; index++)
      await submit('192.0.2.10', index).expect(201);
    await submit('192.0.2.10', 31).expect(429);
    await submit('192.0.2.11', 32).expect(201);
    expect(create).toHaveBeenCalledTimes(31);
  });
});
