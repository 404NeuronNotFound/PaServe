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
    shopDetailsSnapshot: null as unknown,
    shopId,
    orderNumber: 'ORD-000001',
    mode: 'TAKEOUT' as 'TAKEOUT' | 'DINE_IN',
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    currency: 'PHP',
    totalPrice: new Prisma.Decimal('135.50'),
    tableNumber: null as string | null,
    orderItems: [
      {
        lineNumber: 1,
        productSnapshotId: 'saved-product',
        productNameSnapshot: 'Saved Latte',
        currency: 'PHP',
        quantity: 2,
        notes: 'Less ice.\nNo lid.',
        basePriceSnapshot: new Prisma.Decimal('50.00'),
        unitPriceSnapshot: new Prisma.Decimal('67.75'),
        lineTotalSnapshot: new Prisma.Decimal('135.50'),
        variantsSnapshot: [
          {
            id: 'saved-variant',
            name: 'Large',
            optionGroupId: 'saved-size',
            isDefault: false,
            priceAdjustment: '10.00',
          },
        ],
        addOnsSnapshot: [
          { id: 'saved-addon', name: 'Oat milk', priceAdjustment: '7.75' },
        ],
      },
    ],
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

  it('rejects tracking-only credentials at both cashier QR endpoints even for authorized staff', async () => {
    const tracking = tokens.issueTracking(persisted);
    await scan(tracking).expect(403);
    await verify(tracking).expect(403);
    expect(updateOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    'CONFIRMED',
    'REJECTED',
    'CANCELLED',
    'COMPLETED',
    'PREPARING',
    'READY',
    'unknown',
    '',
    'PENDING',
  ])(
    'rejects noneligible order state %s through both QR endpoints',
    async (state) => {
      persisted.status = state;
      for (const endpoint of [scan, verify]) {
        const result = await endpoint().expect(409);
        expect(result.body.code).toBe('ORDER_NOT_PENDING_CONFIRMATION');
        expect(result.body.order).toBeUndefined();
      }
      expect(updateOrder).not.toHaveBeenCalled();
      expect(createOrder).not.toHaveBeenCalled();
    },
  );
  it('verifies credentials before revealing that an order is no longer eligible', async () => {
    persisted.status = 'CONFIRMED';
    const token = tokens.issue(persisted);
    const altered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    await scan(altered).expect(403);
    await verify(altered).expect(403);
  });
  it('allows repeated read-only verification while pending and rejects replay after processing', async () => {
    const token = tokens.issue(persisted);
    await scan(token).expect(200);
    await scan(token).expect(200);
    await verify(token).expect(200);
    await verify(token).expect(200);
    expect(updateOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    persisted.status = 'CONFIRMED';
    await scan(token).expect(409);
    await verify(token).expect(409);
  });
  it('loads saved item snapshots and table context without exposing raw persistence fields', async () => {
    persisted.mode = 'DINE_IN';
    persisted.tableNumber = 'A3';
    Object.assign(persisted.orderItems[0], {
      productId: null,
      snapshot: { productName: 'Wrong legacy name', totalPrice: '999.00' },
    });
    const result = await scan().expect(200);
    expect(result.body.order).toMatchObject({
      mode: 'DINE_IN',
      tableNumber: 'A3',
      totalPrice: '135.50',
      items: [
        {
          productName: 'Saved Latte',
          quantity: 2,
          unitPrice: '67.75',
          totalPrice: '135.50',
          notes: 'Less ice.\nNo lid.',
          variants: [{ name: 'Large', priceAdjustment: '10.00' }],
          addOns: [{ name: 'Oat milk', priceAdjustment: '7.75' }],
        },
      ],
    });
    expect(result.body.order.items[0].snapshot).toBeUndefined();
    expect(result.body.order.items[0].lineNumber).toBeUndefined();
    const liveShop = {
      id: shopId,
      isActive: true,
      members: {
        some: {
          disabledAt: null,
          userId,
          role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
          user: { isActive: true },
        },
      },
    };
    expect(findOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          orderItems: expect.objectContaining({
            orderBy: { lineNumber: 'asc' },
            where: {
              shopId,
              orderId,
              order: { shopId, status: 'PENDING_CONFIRMATION', shop: liveShop },
            },
          }),
        }),
      }),
    );
  });
  it('preserves separate lines for repeated products with different notes', async () => {
    persisted.orderItems.push({
      ...persisted.orderItems[0],
      lineNumber: 2,
      notes: 'Regular ice.',
    });
    persisted.totalPrice = new Prisma.Decimal('271.00');
    const result = await scan().expect(200);
    expect(result.body.order.items).toHaveLength(2);
    expect(
      result.body.order.items.map((item: { notes: string }) => item.notes),
    ).toEqual(['Less ice.\nNo lid.', 'Regular ice.']);
  });
  it.each(['missing', 'gap', 'unitPrice', 'parentTotal', 'lineTotal'])(
    'rejects incomplete or inconsistent saved details (%s)',
    async (kind) => {
      if (kind === 'missing') persisted.orderItems = [];
      if (kind === 'gap') persisted.orderItems[0].lineNumber = 2;
      if (kind === 'unitPrice')
        persisted.orderItems[0].unitPriceSnapshot = new Prisma.Decimal('1.00');
      if (kind === 'parentTotal')
        persisted.totalPrice = new Prisma.Decimal('1.00');
      if (kind === 'lineTotal')
        persisted.orderItems[0].lineTotalSnapshot = new Prisma.Decimal('1.00');
      const result = await scan().expect(409);
      expect(result.body.code).toBe('ORDER_DETAILS_UNAVAILABLE');
      expect(result.body.order).toBeUndefined();
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each([
    'empty name',
    'unsafe note',
    'duplicate modifier',
    'invalid modifier price',
  ])('rejects malformed saved receipt metadata (%s)', async (kind) => {
    const item = persisted.orderItems[0];
    if (kind === 'empty name') item.productNameSnapshot = '';
    if (kind === 'unsafe note') item.notes = 'Coffee\u202e';
    if (kind === 'duplicate modifier') {
      item.addOnsSnapshot.push({
        ...item.addOnsSnapshot[0],
        priceAdjustment: '0.00',
      });
    }
    if (kind === 'invalid modifier price')
      item.addOnsSnapshot[0].priceAdjustment = '7.75e0';
    const result = await scan().expect(409);
    expect(result.body.code).toBe('ORDER_DETAILS_UNAVAILABLE');
    expect(result.body.order).toBeUndefined();
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects at the exact expiry boundary on both endpoints without renewing the token', async () => {
    const token = tokens.issue(persisted);
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(persisted.qrTokenExpiresAt.getTime() - 1);
    try {
      await scan(token).expect(200);
      await verify(token).expect(200);
      now.mockReturnValue(persisted.qrTokenExpiresAt.getTime());
      await scan(token).expect(403);
      await verify(token).expect(403);
      expect(tokens.issue(persisted)).toBe(token);
      expect(updateOrder).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
  it('does not extend an expired credential when persisted expiry is moved later', async () => {
    persisted.qrTokenExpiresAt = new Date(Date.now() - 1);
    const token = tokens.issue(persisted);
    persisted.qrTokenExpiresAt = new Date(Date.now() + 86400000);
    await scan(token).expect(403);
    await verify(token).expect(403);
  });
  it('rejects a signed credential after the persisted nonce changes', async () => {
    const token = tokens.issue(persisted);
    persisted.qrTokenNonce = '75992537-5d60-4d22-8e1e-60a114644681';
    await scan(token).expect(403);
    await verify(token).expect(403);
  });
  it('returns saved public shop details without copying unrelated snapshot fields', async () => {
    const details = {
      name: 'Original Cafe',
      address: '12 Old Street',
      phone: '09171234567',
      contactEmail: null,
      website: null,
    };
    persisted.shopDetailsSnapshot = { ...details, internalField: 'private' };
    const result = await verify().expect(200);
    expect(result.body.order.shopDetails).toEqual(details);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('returns a controlled receipt error instead of 500 for malformed saved shop details', async () => {
    persisted.shopDetailsSnapshot = { name: 42 };
    for (const result of [
      await verify().expect(400),
      await scan().expect(400),
    ]) {
      expect(result.body.code).toBe('RECEIPT_SHOP_DETAILS_UNAVAILABLE');
    }
    expect(updateOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });
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
                  disabledAt: null,
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
          reviewVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
          shopDetails: null,
          items: [
            {
              productId: 'saved-product',
              productName: 'Saved Latte',
              currency: 'PHP',
              quantity: 2,
              notes: 'Less ice.\nNo lid.',
              basePrice: '50.00',
              unitPrice: '67.75',
              totalPrice: '135.50',
              variants: persisted.orderItems[0].variantsSnapshot,
              addOns: persisted.orderItems[0].addOnsSnapshot,
            },
          ],
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
                  disabledAt: null,
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
