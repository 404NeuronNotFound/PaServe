import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('featured ordering', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const foreignShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const first = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const second = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const privateId = 'c47f6994-a303-4a7b-87b0-2386d5198828';
  const membership = vi.fn(),
    findShop = vi.fn(),
    update = vi.fn(),
    transaction = vi.fn();
  let role = 'OWNER';
  let rows: Array<{
    id: string;
    shopId: string;
    categoryId: string | null;
    isFeatured: boolean;
    isArchived: boolean;
    status: string;
    sortOrder: number;
    featuredSortOrder: number;
    price: Prisma.Decimal;
    createdAt: Date;
  }>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser: async () => ({ id: userId }) })
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
    vi.resetAllMocks();
    role = 'OWNER';
    membership.mockImplementation(async ({ where }) => ({
      role,
      shopId: where.userId_shopId.shopId,
      user: { isActive: true },
      shop: { id: where.userId_shopId.shopId, isActive: true },
    }));
    rows = [first, second].map((id, index) => ({
      id,
      shopId,
      categoryId: index ? null : 'category',
      isFeatured: true,
      isArchived: false,
      status: index ? 'HIDDEN' : 'AVAILABLE',
      sortOrder: index + 7,
      featuredSortOrder: index,
      price: new Prisma.Decimal('12.50'),
      createdAt: new Date('2026-10-10'),
    }));
    findShop.mockImplementation(async ({ where }) => ({
      products: rows
        .filter(
          (row) => row.shopId === where.id && row.isFeatured && !row.isArchived,
        )
        .sort(
          (a, b) =>
            a.featuredSortOrder - b.featuredSortOrder ||
            a.id.localeCompare(b.id),
        ),
    }));
    update.mockImplementation(async ({ where, data }) => {
      const row = rows.find(
        (item) =>
          item.id === where.id &&
          item.shopId === where.shopId &&
          item.isFeatured &&
          !item.isArchived,
      )!;
      Object.assign(row, data);
      return { id: row.id };
    });
    transaction.mockImplementation(async (callback) => {
      const before = rows.map((row) => ({ ...row }));
      try {
        return await callback({
          shop: { findFirst: findShop },
          product: { update },
        });
      } catch (error) {
        rows = before;
        throw error;
      }
    });
  });
  const body = () => ({
    productIds: [second, first],
    expectedOrder: [first, second],
  });
  const save = (input: unknown = body(), target = shopId) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${target}/products/featured/reorder`)
      .set('Authorization', 'Bearer valid')
      .send(input);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to arrange cross-category highlights without changing normal ordering',
    async (allowed) => {
      role = allowed;
      const response = await save().expect(200);
      expect(
        response.body.products.map((item) => [
          item.id,
          item.featuredSortOrder,
          item.sortOrder,
        ]),
      ).toEqual([
        [second, 0, 8],
        [first, 1, 7],
      ]);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(transaction.mock.calls[0][1].isolationLevel).toBe('Serializable');
      for (const [args] of update.mock.calls) {
        expect(args.data).toEqual({ featuredSortOrder: expect.any(Number) });
        expect(args.where).toMatchObject({
          shopId,
          isFeatured: true,
          isArchived: false,
          shop: { id: shopId, isActive: true },
        });
        expect(args.where).not.toHaveProperty('categoryId');
      }
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s before a batch write',
    async (denied) => {
      role = denied;
      await save().expect(403);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { productIds: [], expectedOrder: [] },
    { productIds: [first, first], expectedOrder: [first, second] },
    { productIds: ['bad'], expectedOrder: [first] },
    { productIds: [first], expectedOrder: [second] },
    { productIds: [first], expectedOrder: [first], categoryId: null },
    { productIds: [first], expectedOrder: [first], shopId: foreignShop },
  ])('rejects invalid/injected body %j', async (input) => {
    await save(input).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects unselected, archived and foreign products', async () => {
    await save({
      productIds: [privateId, first],
      expectedOrder: [first, privateId],
    }).expect(404);
    await save(body(), foreignShop).expect(404);
    rows[1].isFeatured = false;
    await save().expect(404);
    rows[1].isFeatured = true;
    rows[1].isArchived = true;
    await save().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects stale or incomplete selection without writes', async () => {
    await save({ productIds: [first], expectedOrder: [first] }).expect(409);
    await save({
      productIds: [first, second],
      expectedOrder: [second, first],
    }).expect(409);
    expect(update).not.toHaveBeenCalled();
  });
  it('rolls back a partial write when access is lost', async () => {
    const before = rows.map((row) => ({ ...row }));
    update
      .mockImplementationOnce(async ({ where, data }) => {
        Object.assign(
          rows.find((row) => row.id === where.id)!,
          data,
        );
        return { id: where.id };
      })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Lost access', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
    await save().expect(403);
    expect(rows).toEqual(before);
  });
  it('rejects live access loss and reports serialization conflict without retries', async () => {
    findShop.mockResolvedValue(null);
    await save().expect(403);
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Concurrent change', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await save().expect(409);
    expect(update).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/products/featured/reorder`)
      .send(body())
      .expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('reports adapter commit conflicts without retrying featured ordering', async () => {
    const error = new Error('TransactionWriteConflict', {
      cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
    });
    error.name = 'DriverAdapterError';
    transaction.mockRejectedValue(error);
    const response = await save().expect(409);
    expect(response.body.code).toBe('PRODUCT_ORDER_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
