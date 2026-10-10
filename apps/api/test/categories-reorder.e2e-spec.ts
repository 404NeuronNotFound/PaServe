import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('category reordering', () => {
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
    isVisible: boolean;
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
      name: `Category ${index}`,
      slug: `category-${index}`,
      description: null,
      isVisible: index === 0,
      sortOrder: index + 7,
      createdAt: new Date('2026-10-09T00:00:00Z'),
    }));
    findShop.mockImplementation(async ({ where }) => ({
      categories: rows
        .filter((row) => row.shopId === where.id)
        .toSorted((a, b) => a.sortOrder - b.sortOrder),
    }));
    update.mockImplementation(async ({ where, data }) => {
      const row = rows.find(
        (category) =>
          category.id === where.id && category.shopId === where.shopId,
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
          category: { update },
        });
      } catch (failure) {
        rows = original;
        throw failure;
      }
    });
  });
  const reorder = (
    body: unknown = {
      categoryIds: [second, first],
      expectedOrder: [first, second],
    },
    target = shopId,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${target}/categories/reorder`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to save a full order, including hidden categories',
    async (allowed) => {
      role = allowed;
      const response = await reorder().expect(200);
      expect(
        response.body.categories.map((row) => [row.id, row.sortOrder]),
      ).toEqual([
        [second, 0],
        [first, 1],
      ]);
      expect(response.body.categories[0].isVisible).toBe(false);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'Serializable',
        timeout: 15000,
      });
      for (const call of update.mock.calls) {
        expect(call[0].where).toMatchObject({
          shopId,
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
    { categoryIds: [], expectedOrder: [] },
    { categoryIds: [first, first], expectedOrder: [first, second] },
    { categoryIds: [first, second], expectedOrder: [first, first] },
    { categoryIds: [first], expectedOrder: [first, second] },
    { categoryIds: [first, second], expectedOrder: [first, foreign] },
    { categoryIds: 'bad', expectedOrder: [first] },
    { categoryIds: [null], expectedOrder: [first] },
    { categoryIds: ['bad'], expectedOrder: [first] },
    { categoryIds: [first], expectedOrder: [first], sortOrder: -1 },
    { categoryIds: [first], expectedOrder: [first], shopId: otherShop },
    { categoryIds: Array(501).fill(first), expectedOrder: [first] },
  ])('rejects invalid order input %j', async (body) => {
    await reorder(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects a foreign category or a mixed shop URL even for a member of both shops', async () => {
    await reorder({
      categoryIds: [foreign, first],
      expectedOrder: [first, foreign],
    }).expect(404);
    await reorder(undefined, otherShop).expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects omitted categories and stale ordering without writing', async () => {
    await reorder({ categoryIds: [first], expectedOrder: [first] }).expect(409);
    await reorder({
      categoryIds: [first, second],
      expectedOrder: [second, first],
    }).expect(409);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies guests and malformed shop IDs', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/categories/reorder`)
      .send({ categoryIds: [first], expectedOrder: [first] })
      .expect(401);
    await reorder(undefined, 'bad').expect(400);
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
    expect(response.body.code).toBe('CATEGORY_ORDER_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('reports adapter commit conflicts without retrying the batch', async () => {
    const error = new Error('TransactionWriteConflict', {
      cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
    });
    error.name = 'DriverAdapterError';
    transaction.mockRejectedValue(error);
    const response = await reorder().expect(409);
    expect(response.body.code).toBe('CATEGORY_ORDER_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
