import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('product reordering', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const first = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const second = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const foreign = 'c47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn(),
    membership = vi.fn(),
    findShop = vi.fn(),
    update = vi.fn(),
    transaction = vi.fn();
  let role: string;
  let rows: Array<{
    id: string;
    shopId: string;
    name: string;
    slug: string;
    description: null;
    categoryId: null;
    price: Prisma.Decimal;
    status: 'AVAILABLE' | 'HIDDEN';
    isArchived: boolean;
    isFeatured: boolean;
    imageUrl: null;
    sortOrder: number;
    createdAt: Date;
  }>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        $transaction: transaction,
      })
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
    role = 'OWNER';
    currentUser.mockResolvedValue({ id: userId });
    membership.mockImplementation(async ({ where }) => ({
      id: 'member',
      shopId: where.userId_shopId.shopId,
      role,
      user: { isActive: true },
      shop: {
        id: where.userId_shopId.shopId,
        name: 'Cafe',
        slug: 'cafe',
        isActive: true,
      },
    }));
    rows = [first, second].map((id, index) => ({
      id,
      shopId,
      name: `Product ${index}`,
      slug: `product-${index}`,
      description: null,
      categoryId: null,
      price: new Prisma.Decimal('12.50'),
      status: index === 0 ? 'AVAILABLE' : 'HIDDEN',
      isArchived: false,
      isFeatured: false,
      imageUrl: null,
      sortOrder: index + 7,
      createdAt: new Date('2026-10-09T00:00:00Z'),
    }));
    findShop.mockImplementation(async ({ where }) => ({
      products: rows
        .filter((row) => row.shopId === where.id)
        .toSorted((a, b) => a.sortOrder - b.sortOrder),
    }));
    update.mockImplementation(async ({ where, data }) => {
      const row = rows.find(
        (product) => product.id === where.id && product.shopId === where.shopId,
      );
      if (!row) throw new Error('Invalid write');
      row.sortOrder = data.sortOrder;
      return { id: row.id };
    });
    transaction.mockImplementation(async (callback) => {
      const original = rows.map((row) => ({ ...row }));
      try {
        return await callback({
          shop: { findFirst: findShop },
          product: { update },
        });
      } catch (failure) {
        rows = original;
        throw failure;
      }
    });
  });
  const reorder = (
    body: unknown = {
      categoryId: null,
      productIds: [second, first],
      expectedOrder: [first, second],
    },
    target = shopId,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${target}/products/reorder`)
      .set('Authorization', 'Bearer valid')
      .send({ categoryId: null, ...(body as object) });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to save a full order, including hidden products',
    async (allowed) => {
      role = allowed;
      const response = await reorder().expect(200);
      expect(
        response.body.products.map((row) => [row.id, row.sortOrder]),
      ).toEqual([
        [second, 0],
        [first, 1],
      ]);
      expect(response.body.products[0].status).toBe('HIDDEN');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'Serializable',
        timeout: 15000,
      });
      for (const call of update.mock.calls) {
        expect(call[0].where).toMatchObject({
          shopId,
          categoryId: null,
          isArchived: false,
          shop: {
            id: shopId,
            isActive: true,
            members: {
              some: {
                userId,
                role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
                user: { isActive: true },
              },
            },
          },
        });
        expect(Object.keys(call[0].data)).toEqual(['sortOrder']);
      }
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s before accessing the batch',
    async (denied) => {
      role = denied;
      await reorder().expect(403);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { productIds: [], expectedOrder: [] },
    { productIds: [first, first], expectedOrder: [first, second] },
    { productIds: [first, second], expectedOrder: [first, first] },
    { productIds: [first], expectedOrder: [first, second] },
    { productIds: [first, second], expectedOrder: [first, foreign] },
    { productIds: 'bad', expectedOrder: [first] },
    { productIds: [null], expectedOrder: [first] },
    { productIds: ['bad'], expectedOrder: [first] },
    { productIds: [first], expectedOrder: [first], sortOrder: -1 },
    { productIds: [first], expectedOrder: [first], shopId: otherShop },
    { productIds: Array(501).fill(first), expectedOrder: [first] },
  ])('rejects invalid order input %j', async (body) => {
    await reorder(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects a foreign product or a mixed shop URL even for a member of both shops', async () => {
    await reorder({
      productIds: [foreign, first],
      expectedOrder: [first, foreign],
    }).expect(404);
    await reorder(undefined, otherShop).expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects omitted products and stale ordering without writing', async () => {
    await reorder({ productIds: [first], expectedOrder: [first] }).expect(409);
    await reorder({
      productIds: [first, second],
      expectedOrder: [second, first],
    }).expect(409);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies guests and malformed shop IDs', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/products/reorder`)
      .send({ productIds: [first], expectedOrder: [first] })
      .expect(401);
    await reorder(undefined, 'bad').expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('requires an explicit group and rejects malformed category IDs', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/products/reorder`)
      .set('Authorization', 'Bearer valid')
      .send({ productIds: [second, first], expectedOrder: [first, second] })
      .expect(400);
    await reorder({
      categoryId: 'bad',
      productIds: [second, first],
      expectedOrder: [first, second],
    }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rolls back earlier updates if a later write loses access', async () => {
    const original = rows.map((row) => ({ ...row }));
    update
      .mockImplementationOnce(async ({ where, data }) => {
        rows.find((row) => row.id === where.id)!.sortOrder = data.sortOrder;
        return { id: where.id };
      })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Lost access', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
    await reorder().expect(403);
    expect(rows).toEqual(original);
  });
  it('blocks permission loss at the transaction read', async () => {
    findShop.mockResolvedValue(null);
    await reorder().expect(403);
    expect(update).not.toHaveBeenCalled();
  });
  it('reports serialization conflicts without automatic retry', async () => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Concurrent change', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    const response = await reorder().expect(409);
    expect(response.body.code).toBe('PRODUCT_ORDER_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('reports adapter commit conflicts without retrying the batch', async () => {
    const error = new Error('TransactionWriteConflict', {
      cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
    });
    error.name = 'DriverAdapterError';
    transaction.mockRejectedValue(error);
    const response = await reorder().expect(409);
    expect(response.body.code).toBe('PRODUCT_ORDER_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
