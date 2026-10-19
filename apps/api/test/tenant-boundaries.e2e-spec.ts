import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { ProductImageStorage } from '../src/modules/products/product-image.storage.js';
import { ShopLogoStorage } from '../src/modules/shops/shop-logo.storage.js';
import { ShopBannerStorage } from '../src/modules/shops/shop-banner.storage.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

const tenants = [
  {
    shop: '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
    actor: '75992537-5d60-4d22-8e1e-60a114644681',
    product: 'a47f6994-a303-4a7b-87b0-2386d5198828',
    order: '1987ca36-fd7b-4201-830d-e1da03ab5ed7',
    member: 'c47f6994-a303-4a7b-87b0-2386d5198828',
    invite: 'e47f6994-a303-4a7b-87b0-2386d5198828',
    amount: '11.00',
  },
  {
    shop: '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24',
    actor: '85992537-5d60-4d22-8e1e-60a114644681',
    product: 'b47f6994-a303-4a7b-87b0-2386d5198828',
    order: '2987ca36-fd7b-4201-830d-e1da03ab5ed7',
    member: 'd47f6994-a303-4a7b-87b0-2386d5198828',
    invite: 'f47f6994-a303-4a7b-87b0-2386d5198828',
    amount: '99.00',
  },
] as const;
const missing = '0987ca36-fd7b-4201-830d-e1da03ab5ed7';
type Where = { id?: string; shopId?: string };
type HttpMethod = 'get' | 'post' | 'patch' | 'delete';
// Omitted predicates behave like unscoped database reads, exposing regressions.
const matches = (row: { id: string; shopId: string }, where: Where) =>
  (!where.id || row.id === where.id) &&
  (!where.shopId || row.shopId === where.shopId);

describe('Real-route tenant boundaries', () => {
  let app: INestApplication<App>;
  let bothShops = false;
  const membership = vi.fn();
  const storage = { upload: vi.fn(), remove: vi.fn(), removePrevious: vi.fn() };
  const db = {
    shop: { findFirst: vi.fn(), update: vi.fn() },
    product: { findFirst: vi.fn(), update: vi.fn() },
    order: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      updateMany: vi.fn(),
    },
    shopMember: {
      findUnique: membership,
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    staffInvitation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    staffAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const now = new Date('2026-10-19T00:00:00Z');
  const products = tenants.map((t) => ({
    id: t.product,
    shopId: t.shop,
    name: `Menu ${t.shop}`,
    price: new Prisma.Decimal(t.amount),
    createdAt: now,
  }));
  const orders = tenants.map((t) => ({
    id: t.order,
    shopId: t.shop,
    orderNumber: `ORDER-${t.shop}`,
    mode: 'TAKEOUT',
    status: 'REJECTED',
    paymentStatus: 'UNPAID',
    preparationStatus: null,
    totalPrice: new Prisma.Decimal(t.amount),
    createdAt: now,
    updatedAt: now,
    orderItems: [],
    shopDetailsSnapshot: null,
  }));
  const members = tenants.map((t) => ({
    id: t.member,
    shopId: t.shop,
    userId: t.member,
    role: 'CASHIER',
    disabledAt: null,
    user: { email: `${t.shop}@example.test`, isActive: true },
  }));
  const invites = tenants.map((t) => ({
    id: t.invite,
    shopId: t.shop,
    email: `${t.shop}@example.test`,
    role: 'CASHIER',
    expiresAt: new Date('2099-01-01'),
    acceptedAt: null,
    revokedAt: null,
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(AuthService)
      .useValue({
        currentUser: async (token: string) => ({
          id: token,
          memberships: [{ shopId: tenants[1].shop, role: 'OWNER' }],
        }),
      })
      .overrideProvider(ProductImageStorage)
      .useValue(storage)
      .overrideProvider(ShopLogoStorage)
      .useValue(storage)
      .overrideProvider(ShopBannerStorage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    vi.resetAllMocks();
    bothShops = false;
    membership.mockImplementation(async ({ where }) => {
      const { userId, shopId } = where.userId_shopId;
      if (
        !tenants.some(
          (t) => t.actor === userId && (bothShops || t.shop === shopId),
        )
      )
        return null;
      return {
        id: `${userId}:${shopId}`,
        shopId,
        role: 'OWNER',
        user: { isActive: true },
        shop: { id: shopId, name: 'Cafe', slug: shopId, isActive: true },
      };
    });
    db.shop.findFirst.mockImplementation(async ({ where, select }) => {
      const tenant = tenants.find((t) => t.shop === where.id);
      if (!tenant) return null;
      return {
        id: tenant.shop,
        products: select?.products
          ? products.filter((row) => matches(row, select.products.where))
          : undefined,
      };
    });
    db.product.findFirst.mockImplementation(
      async ({ where }) => products.find((row) => matches(row, where)) ?? null,
    );
    db.order.findFirst.mockImplementation(
      async ({ where }) => orders.find((row) => matches(row, where)) ?? null,
    );
    db.order.findMany.mockResolvedValue([]);
    db.order.aggregate.mockImplementation(async ({ where }) => {
      const rows = orders.filter((row) => matches(row, where));
      return {
        _count: { _all: rows.length },
        _sum: {
          totalPrice: rows.reduce(
            (total, row) => total.plus(row.totalPrice),
            new Prisma.Decimal(0),
          ),
        },
      };
    });
    db.shopMember.findFirst.mockImplementation(
      async ({ where }) => members.find((row) => matches(row, where)) ?? null,
    );
    db.shopMember.findMany.mockImplementation(async ({ where }) =>
      members.filter((row) => matches(row, where)),
    );
    db.staffInvitation.findFirst.mockImplementation(
      async ({ where }) => invites.find((row) => matches(row, where)) ?? null,
    );
    db.staffInvitation.findMany.mockImplementation(async ({ where }) =>
      invites.filter((row) => matches(row, where)),
    );
    db.$transaction.mockImplementation(async (work) => work(db));
    db.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
  });
  function call(
    method: HttpMethod,
    path: string,
    actor: string,
  ) {
    return request(app.getHttpServer())
      [method](`/api/v1/shops/${path}`)
      .set('Authorization', `Bearer ${actor}`);
  }
  function noWrites() {
    for (const mock of [
      storage.upload,
      storage.remove,
      storage.removePrevious,
      db.product.update,
      db.order.updateMany,
      db.shop.update,
      db.shopMember.updateMany,
      db.shopMember.deleteMany,
      db.staffInvitation.updateMany,
      db.staffAuditEvent.create,
    ])
      expect(mock).not.toHaveBeenCalled();
  }

  describe.each([0, 1])('owner %i', (index) => {
    const own = tenants[index],
      foreign = tenants[1 - index];
    const routes = [
      ['get', 'products'],
      ['patch', `products/${foreign.product}`],
      ['post', `products/${foreign.product}/image`],
      ['get', `orders/${foreign.order}/details`],
      ['get', 'orders/active'],
      ['post', `orders/${foreign.order}/confirm`],
      ['post', `orders/${foreign.order}/start-preparing`],
      ['get', 'staff'],
      ['patch', `staff/members/${foreign.member}`],
      ['delete', `staff/members/${foreign.member}`],
      ['delete', `staff/invitations/${foreign.invite}`],
      ['post', 'logo'],
      ['delete', 'logo'],
      ['post', 'banner'],
      ...[
        'sales-trends',
        'average-prep-time',
        'peak-hours',
        'top-products',
        'custom-sales',
        'monthly-analytics',
        'weekly-analytics',
        'daily-analytics',
        'daily-sales',
        'completed-sales',
      ].map((path) => ['get', `reports/${path}`]),
    ] as const;
    it.each(routes)(
      'blocks foreign shop %s %s before business queries',
      async (method, path) => {
          await call(method as HttpMethod, `${foreign.shop}/${path}`, own.actor)
          .set('X-Shop-Id', own.shop)
          .query({ shopId: own.shop, role: 'OWNER' })
          .expect(404);
        for (const mock of [
          db.shop.findFirst,
          db.product.findFirst,
          db.order.findFirst,
          db.order.findMany,
          db.order.aggregate,
          db.$transaction,
        ])
          expect(mock).not.toHaveBeenCalled();
        noWrites();
      },
    );

    it('returns only the chosen shop products, staff, invitations and sales for a dual-shop owner', async () => {
      bothShops = true;
      const menu = await call('get', `${own.shop}/products`, own.actor)
        .query({ shopId: foreign.shop })
        .expect(200);
      expect(menu.body.products.map((p: { id: string }) => p.id)).toEqual([
        own.product,
      ]);
      const staff = await call('get', `${own.shop}/staff`, own.actor).expect(
        200,
      );
      expect(staff.body.members.map((m: { id: string }) => m.id)).toEqual([
        own.member,
      ]);
      expect(staff.body.invitations.map((m: { id: string }) => m.id)).toEqual([
        own.invite,
      ]);
      const report = await call(
        'get',
        `${own.shop}/reports/completed-sales`,
        own.actor,
      )
        .query({
          from: '2026-10-01T00:00:00Z',
          to: '2026-11-01T00:00:00Z',
          shopId: foreign.shop,
        })
        .expect(200);
      expect(report.body.totalSales).toBe(own.amount);
      expect(db.order.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopId: own.shop,
            shop: expect.objectContaining({
              id: own.shop,
              members: {
                some: expect.objectContaining({
                  userId: own.actor,
                  disabledAt: null,
                }),
              },
            }),
          }),
        }),
      );
      expect(db.shop.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            products: expect.objectContaining({ where: { shopId: own.shop } }),
          }),
        }),
      );
    });

    const resources = [
      ['patch', 'products', own.product, foreign.product, ''],
      ['post', 'products', own.product, foreign.product, '/image'],
      ['get', 'orders', own.order, foreign.order, '/details'],
      ['patch', 'staff/members', own.member, foreign.member, ''],
      ['patch', 'staff/members', own.member, foreign.member, '/access'],
      ['delete', 'staff/members', own.member, foreign.member, ''],
      ['delete', 'staff/invitations', own.invite, foreign.invite, ''],
    ] as const;
    it.each(resources)(
      'denies mixed-shop %s %s IDs even with membership in both shops',
      async (method, path, _localId, foreignId, suffix) => {
        bothShops = true;
        const attempt = (id: string) =>
          call(method, `${own.shop}/${path}/${id}${suffix}`, own.actor)
            .set('X-Shop-Id', foreign.shop)
            .query({ shopId: foreign.shop })
            .send(
              method === 'patch'
                ? suffix === '/access'
                  ? { isEnabled: false }
                  : path === 'products'
                    ? { name: 'Changed' }
                    : { role: 'MANAGER' }
                : {},
            );
        const denied = await attempt(foreignId).expect(404);
        const absent = await attempt(missing).expect(404);
        expect(denied.body).toEqual(absent.body);
        noWrites();
      },
    );

    it('allows its own order details but hides a foreign order with the same route shop', async () => {
      const ownResponse = await call(
        'get',
        `${own.shop}/orders/${own.order}/details`,
        own.actor,
      ).expect(200);
      expect(ownResponse.body.order.id).toBe(own.order);
      expect(ownResponse.body.order.shopId).toBe(own.shop);
      bothShops = true;
      await call(
        'get',
        `${own.shop}/orders/${foreign.order}/details`,
        own.actor,
      ).expect(404);
      expect(db.order.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: foreign.order,
            shopId: own.shop,
          }),
          select: expect.objectContaining({
            orderItems: expect.objectContaining({
              where: expect.objectContaining({
                shopId: own.shop,
                orderId: foreign.order,
              }),
            }),
          }),
        }),
      );
    });
  });
});
