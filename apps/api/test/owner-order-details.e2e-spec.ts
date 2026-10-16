import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('Owner order details HTTP', () => {
  const actorId = '75992537-5d60-4d22-8e1e-60a114644681',
    shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
    orderId = '1987ca36-fd7b-4201-830d-e1da03ab5ed7';
  let app: INestApplication<App>, role: ShopRole, active: boolean;
  const findFirst = vi.fn(),
    membership = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        order: { findFirst },
        shopMember: { findUnique: membership },
      })
      .overrideProvider(AuthService)
      .useValue({ currentUser: async () => ({ id: actorId }) })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    role = 'OWNER';
    active = true;
    membership.mockImplementation(
      async ({ where }: { where: { userId_shopId: { shopId: string } } }) =>
        where.userId_shopId.shopId === shopId && active
          ? {
              id: 'member',
              shopId,
              role,
              user: { isActive: true },
              shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
            }
          : null,
    );
    findFirst.mockResolvedValue(null);
  });
  const get = (target = shopId, id = orderId, suffix = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/shops/${target}/orders/${id}/details${suffix}`)
      .set('Authorization', 'Bearer test');
  it.each<ShopRole>(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'])(
    'denies %s',
    async (value) => {
      role = value;
      await get().expect(403);
      expect(findFirst).not.toHaveBeenCalled();
    },
  );
  it('denies unauthenticated reads', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/orders/${orderId}/details`)
      .expect(401);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('denies another shop despite forged owner hints', async () => {
    await get(
      '1987ca36-fd7b-4201-830d-e1da03ab5ed7',
      orderId,
      `?shopId=${shopId}&role=OWNER`,
    ).expect(404);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('denies revoked membership', async () => {
    active = false;
    await get().expect(404);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('rechecks live ownership after the membership guard', async () => {
    membership.mockImplementationOnce(async () => {
      role = 'CASHIER';
      return { id: 'member', shopId, role: 'OWNER', user: { isActive: true }, shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true } };
    });
    await get().expect(403);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('scopes a missing/foreign resource to the authenticated owner and explicit shop', async () => {
    await get(shopId, orderId, '?role=OWNER&shopId=forged').expect(404);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: orderId,
      shopId,
    });
    expect(JSON.stringify(findFirst.mock.calls[0][0].where.shop)).toContain(
      actorId,
    );
  });
  it('validates order IDs', async () => {
    await get(shopId, 'bad-id').expect(400);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('returns no-store audit metadata even when a legacy snapshot is unavailable', async () => {
    findFirst.mockResolvedValue({
      id: orderId,
      shopId,
      orderNumber: 'ORD-000042',
      mode: 'TAKEOUT',
      tableNumber: null,
      status: 'REJECTED',
      paymentStatus: 'UNPAID',
      preparationStatus: null,
      totalPrice: new Prisma.Decimal('12.00'),
      createdAt: new Date('2026-10-16T00:00:00Z'),
      updatedAt: new Date('2026-10-16T00:01:00Z'),
      decidedAt: new Date('2026-10-16T00:01:00Z'),
      decidedBy: actorId,
      rejectionReason: 'Out of stock',
      paidAt: null,
      queuedAt: null,
      preparationStartedAt: null,
      preparationReadyAt: null,
      completedAt: null,
      shopDetailsSnapshot: null,
      orderItems: [],
      qrTokenNonce: 'never expose',
      paymentRequestId: 'never expose',
    });
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.order).toMatchObject({
      id: orderId,
      shopId,
      totalPrice: '12.00',
      items: null,
      rejectionReason: 'Out of stock',
      permittedActions: [],
      history: [{ status: 'PLACED' }, { status: 'REJECTED', actorId }],
    });
    expect(JSON.stringify(response.body)).not.toContain('never expose');
  });
});
