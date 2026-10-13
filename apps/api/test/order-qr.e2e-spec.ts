import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { OrderTokenService } from '../src/modules/orders/order-token.service.js';
import { TableContextService } from '../src/modules/tables/table-context.service.js';

describe('Cashier order QR verification', () => {
  let app: INestApplication<App>;
  let tokens: OrderTokenService;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const orderId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const otherOrder = '729b86f1-8a08-45de-af94-03dfe49f0f0b';
  const currentUser = vi.fn();
  const findMembership = vi.fn();
  const findOrder = vi.fn();
  const updateOrder = vi.fn();
  const createOrder = vi.fn();
  let role: ShopRole;
  let activeUser: boolean;
  let activeShop: boolean;
  let hasMembership: boolean;
  const savedOrder = () => ({
    id: orderId,
    shopId,
    orderNumber: 'ORD-000001',
    mode: 'TAKEOUT' as const,
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    currency: 'PHP',
    totalPrice: new Prisma.Decimal('135.50'),
    tableNumber: null,
    ...tokens.metadata(),
    qrTokenRevokedAt: null as Date | null,
  });
  let persisted: ReturnType<typeof savedOrder>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: findMembership },
        order: {
          findFirst: findOrder,
          update: updateOrder,
          create: createOrder,
        },
      })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .compile();
    tokens = module.get(OrderTokenService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    role = 'CASHIER';
    activeUser = true;
    activeShop = true;
    hasMembership = true;
    persisted = savedOrder();
    // Cached role claims must never grant access.
    currentUser.mockResolvedValue({
      id: userId,
      memberships: [{ shopId, role: 'OWNER' }],
    });
    findMembership.mockImplementation(async ({ where }) =>
      hasMembership
        ? {
            id: 'membership',
            shopId: where.userId_shopId.shopId,
            role,
            user: { isActive: activeUser },
            shop: {
              id: where.userId_shopId.shopId,
              name: 'Cafe',
              slug: 'cafe',
              isActive: activeShop,
            },
          }
        : null,
    );
    findOrder.mockImplementation(async ({ where }) =>
      where.id === persisted.id && where.shopId === persisted.shopId
        ? persisted
        : null,
    );
  });
  const verify = (
    token = tokens.issue(persisted),
    targetShop = shopId,
    targetOrder = orderId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${targetShop}/orders/${targetOrder}/verify-qr`)
      .set('Authorization', 'Bearer staff-session')
      .send({ qrToken: token });
  const scan = (token = tokens.issue(persisted), targetShop = shopId) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${targetShop}/orders/scan-qr`)
      .set('Authorization', 'Bearer staff-session')
      .send({ qrToken: token });

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'resolves a scanned token for live %s and returns only saved order details',
    async (allowedRole) => {
      role = allowedRole;
      const result = await scan().expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.order).toMatchObject({
        id: orderId,
        shopId,
        orderNumber: persisted.orderNumber,
        totalPrice: '135.50',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'UNPAID',
      });
      expect(result.body.order.qrToken).toBeUndefined();
      expect(findOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: orderId,
            shopId,
            shop: expect.objectContaining({
              members: {
                some: {
                  userId,
                  role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
                  user: { isActive: true },
                },
              },
            }),
          }),
        }),
      );
      expect(updateOrder).not.toHaveBeenCalled();
      expect(createOrder).not.toHaveBeenCalled();
    },
  );
  it('requires authentication and a permitted live role for token resolution', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/scan-qr`)
      .send({ qrToken: tokens.issue(persisted) })
      .expect(401);
    role = 'KITCHEN';
    await scan().expect(403);
    expect(findOrder).not.toHaveBeenCalled();
  });
  it.each(['membership', 'user', 'shop'])(
    'denies inactive/missing %s before resolving a scanned token',
    async (state) => {
      if (state === 'membership') hasMembership = false;
      if (state === 'user') activeUser = false;
      if (state === 'shop') activeShop = false;
      await scan().expect(404);
      expect(findOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['orderId', 'shopId', 'totalPrice', 'verificationUrl'])(
    'rejects untrusted embedded %s before order lookup',
    async (field) => {
      const original = tokens.issue(persisted).split('.');
      const claims = JSON.parse(
        Buffer.from(original[0], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const values = {
        orderId: otherOrder,
        shopId: otherShop,
        totalPrice: '0.01',
        verificationUrl: 'https://example.com/steal',
      };
      claims[field] = values[field as keyof typeof values];
      const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${original[1]}`;
      await scan(forged).expect(403);
      expect(findOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects a valid token for another active shop without retargeting the request', async () => {
    await scan(tokens.issue(persisted), otherShop).expect(403);
    expect(findOrder).not.toHaveBeenCalled();
  });
  it('still enforces persisted revocation and expiry after signed resolution', async () => {
    const token = tokens.issue(persisted);
    persisted.qrTokenRevokedAt = new Date();
    await scan(token).expect(403);
    persisted.qrTokenRevokedAt = null;
    persisted.qrTokenExpiresAt = new Date(0);
    await scan(token).expect(403);
  });
  it('returns no order details when access changes after the scanner guard', async () => {
    findOrder.mockResolvedValue(null);
    await scan().expect(404);
  });
  it.each([
    { qrToken: 'token', orderId: otherOrder },
    { qrToken: 'token', totalPrice: '0.01' },
    { qrToken: 'token', status: 'CONFIRMED' },
    { qrToken: 'token', verificationUrl: 'https://example.com/steal' },
  ])(
    'refuses client-supplied order details in a scan request %j',
    async (body) => {
      await request(app.getHttpServer())
        .post(`/api/v1/shops/${shopId}/orders/scan-qr`)
        .set('Authorization', 'Bearer staff-session')
        .send(body)
        .expect(400);
      expect(findOrder).not.toHaveBeenCalled();
    },
  );

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'permits live %s to verify without changing the order',
    async (allowedRole) => {
      role = allowedRole;
      const result = await verify().expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toEqual({
        verified: true,
        order: {
          id: orderId,
          shopId,
          orderNumber: 'ORD-000001',
          mode: 'TAKEOUT',
          status: 'PENDING_CONFIRMATION',
          paymentStatus: 'UNPAID',
          currency: 'PHP',
          totalPrice: '135.50',
          tableNumber: null,
        },
      });
      expect(updateOrder).not.toHaveBeenCalled();
      expect(createOrder).not.toHaveBeenCalled();
      expect(findOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: orderId,
            shopId,
            shop: {
              id: shopId,
              isActive: true,
              members: {
                some: {
                  userId,
                  role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
                  user: { isActive: true },
                },
              },
            },
          },
        }),
      );
    },
  );
  it('requires staff authentication even with a valid QR', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/verify-qr`)
      .send({ qrToken: tokens.issue(persisted) })
      .expect(401);
    expect(findOrder).not.toHaveBeenCalled();
  });
  it('denies kitchen staff despite cached OWNER claims', async () => {
    role = 'KITCHEN';
    await verify().expect(403);
    expect(findOrder).not.toHaveBeenCalled();
  });
  it.each(['membership', 'user', 'shop'])(
    'denies inactive/missing %s',
    async (state) => {
      if (state === 'membership') hasMembership = false;
      if (state === 'user') activeUser = false;
      if (state === 'shop') activeShop = false;
      await verify().expect(404);
      expect(findOrder).not.toHaveBeenCalled();
    },
  );
  it('fails closed if live access changes after the guard', async () => {
    findOrder.mockResolvedValue(null);
    expect((await verify().expect(404)).body.code).toBe('ORDER_NOT_ACCESSIBLE');
  });
  it.each([otherShop, shopId])(
    'hides foreign or missing orders under %s',
    async (targetShop) => {
      await verify(
        tokens.issue(persisted),
        targetShop,
        targetShop === shopId ? otherOrder : orderId,
      ).expect(404);
    },
  );
  it.each(['order', 'shop', 'nonce', 'signature', 'payload'])(
    'rejects altered %s binding',
    async (kind) => {
      const original = tokens.issue(persisted);
      let token = original;
      if (kind === 'order')
        token = tokens.issue({ ...persisted, id: otherOrder });
      if (kind === 'shop')
        token = tokens.issue({ ...persisted, shopId: otherShop });
      if (kind === 'nonce')
        token = tokens.issue({ ...persisted, ...tokens.metadata() });
      if (kind === 'signature') token = `${original}x`;
      if (kind === 'payload') token = `x${original.slice(1)}`;
      expect((await verify(token).expect(403)).body.code).toBe(
        'ORDER_TOKEN_INVALID',
      );
    },
  );
  it.each(['expired', 'revoked'])(
    'rejects %s tokens using saved state',
    async (state) => {
      if (state === 'expired')
        persisted.qrTokenExpiresAt = new Date(Date.now() - 1);
      const token = tokens.issue(persisted);
      if (state === 'revoked') persisted.qrTokenRevokedAt = new Date();
      expect((await verify(token).expect(403)).body.code).toBe(
        'ORDER_TOKEN_INVALID',
      );
    },
  );
  it.each(['ORD-000001', orderId, 'invalid'])(
    'rejects %s as a security credential',
    async (token) => {
      await verify(token).expect(403);
    },
  );
  it('rejects table tokens', async () => {
    const tableToken = new TableContextService(new ConfigService()).issue(
      'cafe',
      'T1',
    );
    await verify(tableToken).expect(403);
  });
  it.each([
    {},
    { qrToken: '' },
    { qrToken: 123 },
    { qrToken: 'x'.repeat(1025) },
    { qrToken: 'token', role: 'OWNER' },
  ])('validates the request allowlist: %j', async (body) => {
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/verify-qr`)
      .set('Authorization', 'Bearer staff-session')
      .send(body)
      .expect(400);
    expect(findOrder).not.toHaveBeenCalled();
  });
  it('requires UUID resource identifiers', async () => {
    await verify(undefined, shopId, 'ORD-000001').expect(400);
    expect(findOrder).not.toHaveBeenCalled();
  });
});
