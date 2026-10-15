import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { OrderTokenService } from '../src/modules/orders/order-token.service.js';
import { NewOrderEventsService } from '../src/modules/orders/new-order-events.service.js';

describe('Confirmed order customer/staff HTTP access', () => {
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const id = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  let app: INestApplication<App>, tokens: OrderTokenService;
  let role: 'CASHIER' | 'KITCHEN' | 'OWNER';
  const findOrder = vi.fn(),
    findShop = vi.fn(),
    membership = vi.fn();
  let relay: ReturnType<typeof vi.spyOn>;
  let order: {
    id: string;
    shopId: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    decidedAt: Date;
    updatedAt: Date;
    qrTokenNonce: string;
    qrTokenExpiresAt: Date;
    qrTokenRevokedAt: Date | null;
    receiptAccessRevokedAt: Date | null;
    preparationStatus: string | null;
    preparationStartedAt: Date | null;
    preparationReadyAt: Date | null;
    completedAt: Date | null;
    queuedAt: Date | null;
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        shop: { findFirst: findShop },
        order: { findFirst: findOrder },
        shopMember: { findUnique: membership },
      })
      .overrideProvider(AuthService)
      .useValue({
        currentUser: async () => ({
          id: '75992537-5d60-4d22-8e1e-60a114644681',
        }),
      })
      .compile();
    tokens = module.get(OrderTokenService);
    relay = vi
      .spyOn(module.get(NewOrderEventsService), 'relay')
      .mockImplementation(
        async (_topic, _event, _scope, authorize, response) => {
          await authorize();
          response.end();
        },
      );
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    role = 'CASHIER';
    order = {
      id,
      shopId,
      orderNumber: 'ORD-000042',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      decidedAt: new Date(),
      updatedAt: new Date(),
      ...tokens.metadata(),
      qrTokenRevokedAt: new Date(),
      receiptAccessRevokedAt: null,
      preparationStatus: null,
      preparationStartedAt: null,
      preparationReadyAt: null,
      completedAt: null,
      queuedAt: null,
    };
    findShop.mockImplementation(async ({ where }) =>
      where.slug === 'cafe' ? { id: shopId } : null,
    );
    findOrder.mockImplementation(async ({ where }) =>
      where.id === id && where.shopId === shopId ? order : null,
    );
    membership.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? {
            id: 'member',
            shopId,
            role,
            user: { isActive: true },
            shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
          }
        : null,
    );
  });
  const customer = (
    suffix: string,
    token = tokens.issue(order),
    slug = 'cafe',
    orderId = id,
  ) =>
    request(app.getHttpServer())
      .get(`/api/v1/menu/${slug}/orders/${orderId}/${suffix}`)
      .set('Authorization', `Bearer ${token}`);
  it('returns minimal confirmed status after QR scan consumption without staff authentication', async () => {
    const result = await customer('status').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.order).toMatchObject({
      id,
      shopId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    });
    expect(Object.keys(result.body.order)).not.toContain('qrTokenNonce');
  });
  it('keeps receipt reads authorized and available when realtime is unavailable', async () => {
    relay.mockImplementationOnce(async () => {
      throw new ServiceUnavailableException({
        code: 'REALTIME_UNAVAILABLE',
        message: 'Live updates are temporarily unavailable.',
      });
    });
    const failed = await customer('events').expect(503);
    expect(failed.body.code).toBe('REALTIME_UNAVAILABLE');
    const saved = await customer('status').expect(200);
    expect(saved.body.order).toMatchObject({
      id,
      shopId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    });
    await customer('status', 'tampered-receipt').expect(403);
  });
  it('returns the current preparation state through the same credential-protected receipt', async () => {
    order.preparationStatus = 'PREPARING';
    order.queuedAt = new Date();
    order.preparationStartedAt = new Date(order.queuedAt.getTime() + 1000);
    const result = await customer('status').expect(200);
    expect(result.body.order).toMatchObject({
      preparationStatus: 'PREPARING',
      preparationStartedAt: order.preparationStartedAt.toISOString(),
    });
    expect(result.body.order).not.toHaveProperty('preparationStartedBy');
  });
  it('returns READY and its saved timestamp without staff actor or fulfillment metadata', async () => {
    order.preparationStatus = 'READY';
    order.queuedAt = new Date();
    order.preparationStartedAt = new Date(order.queuedAt.getTime() + 1000);
    order.preparationReadyAt = new Date(order.queuedAt.getTime() + 2000);
    const result = await customer('status').expect(200);
    expect(result.body.order).toMatchObject({
      preparationStatus: 'READY',
      preparationReadyAt: order.preparationReadyAt.toISOString(),
      paymentStatus: 'PAID',
    });
    expect(result.body.order).not.toHaveProperty('preparationReadyBy');
    expect(result.body.order.completedAt).toBeNull();
  });
  it('returns terminal completion to the receipt holder without exposing its actor', async () => {
    order.status = 'CONFIRMED';
    order.paymentStatus = 'PAID';
    order.decidedAt = new Date();
    order.queuedAt = order.decidedAt;
    order.preparationStatus = 'COMPLETED';
    order.preparationStartedAt = new Date(order.queuedAt.getTime() + 1000);
    order.preparationReadyAt = new Date(order.queuedAt.getTime() + 2000);
    order.completedAt = new Date(order.queuedAt.getTime() + 3000);
    const result = await customer('status').expect(200);
    expect(result.body.order).toMatchObject({
      preparationStatus: 'COMPLETED',
      completedAt: order.completedAt.toISOString(),
      paymentStatus: 'PAID',
    });
    expect(result.body.order).not.toHaveProperty('completedBy');
    order.completedAt = null;
    await customer('status').expect(400);
  });
  it.each(['OWNER', 'KITCHEN'] as const)(
    // Both preparation-start and ready events use this live permission boundary.
    'permits the preparation dashboard stream for %s',
    async (value) => {
      role = value;
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/preparation-events`)
        .set('Authorization', 'Bearer staff-session')
        .expect(200);
      expect(relay).toHaveBeenCalledWith(
        `staff:preparation:${shopId}`,
        ['order_preparing', 'order_ready', 'order_completed'],
        { shopId },
        expect.any(Function),
        expect.anything(),
      );
    },
  );
  it('denies cashier-only, anonymous and other-shop preparation dashboard subscriptions', async () => {
    const path = `/api/v1/shops/${shopId}/orders/preparation-events`;
    await request(app.getHttpServer()).get(path).expect(401);
    role = 'CASHIER';
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer staff-session')
      .expect(403);
    role = 'OWNER';
    await request(app.getHttpServer())
      .get(
        '/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/orders/preparation-events',
      )
      .set('Authorization', 'Bearer staff-session')
      .expect(404);
  });
  it('requires a credential, and denies tampered/expired/revoked receipts', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/menu/cafe/orders/${id}/status`)
      .expect(401);
    await customer('status', 'invalid').expect(403);
    const token = tokens.issue(order);
    order.receiptAccessRevokedAt = new Date();
    await customer('events', token).expect(403);
    order.receiptAccessRevokedAt = null;
    order.qrTokenExpiresAt = new Date(0);
    await customer('status', token).expect(403);
    expect(relay).not.toHaveBeenCalled();
  });
  it('binds customer reads and streams to the route shop and exact order', async () => {
    await customer('status', tokens.issue(order), 'other').expect(404);
    await customer(
      'events',
      tokens.issue(order),
      'cafe',
      '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24',
    ).expect(404);
    await customer('events').expect(200);
    expect(relay).toHaveBeenCalledWith(
      `customer:confirmed:${shopId}:${id}`,
      ['order_confirmed', 'order_preparing', 'order_ready', 'order_completed'],
      { shopId, orderId: id },
      expect.any(Function),
      expect.anything(),
    );
  });
  it.each(['CASHIER', 'OWNER'] as const)(
    'permits live staff confirmation reads for %s',
    async (value) => {
      role = value;
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/orders/confirmed-events`)
        .set('Authorization', 'Bearer staff-session')
        .expect(200);
      expect(relay).toHaveBeenCalledWith(
        `staff:confirmed:${shopId}`,
        [
          'order_confirmed',
          'order_preparing',
          'order_ready',
          'order_completed',
        ],
        { shopId },
        expect.any(Function),
        expect.anything(),
      );
    },
  );
  it('denies kitchen-only, anonymous, and other-shop staff subscriptions', async () => {
    const path = `/api/v1/shops/${shopId}/orders/confirmed-events`;
    await request(app.getHttpServer()).get(path).expect(401);
    role = 'KITCHEN';
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer staff')
      .expect(403);
    role = 'OWNER';
    await request(app.getHttpServer())
      .get(
        `/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/orders/confirmed-events`,
      )
      .set('Authorization', 'Bearer staff')
      .expect(404);
  });
});
