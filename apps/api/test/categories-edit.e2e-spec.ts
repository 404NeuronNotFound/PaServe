import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
describe('category editing and deletion', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681',
    shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
    otherShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const id = 'a47f6994-a303-4a7b-87b0-2386d5198828',
    foreign = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const findMembership = vi.fn(),
    findCategory = vi.fn(),
    update = vi.fn(),
    currentUser = vi.fn();
  const deleteRecord = vi.fn();
  let role: string;
  const original = {
    id,
    shopId,
    name: 'Coffee',
    description: null,
    slug: 'coffee',
    isVisible: false,
    sortOrder: 7,
    createdAt: new Date('2026-10-09T00:00:00Z'),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: findMembership },
        category: { findFirst: findCategory, update, delete: deleteRecord },
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
    findMembership.mockImplementation(async ({ where }) => ({
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
    findCategory.mockImplementation(async ({ where }) =>
      where.id === id && where.shopId === shopId ? { id, shopId } : null,
    );
    update.mockImplementation(async ({ data }) => ({ ...original, ...data }));
    deleteRecord.mockResolvedValue({ id });
  });
  const patch = (
    body: unknown = { name: 'Drinks', description: 'Freshly brewed' },
    resource = id,
    target = shopId,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${target}/categories/${resource}`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  const remove = (resource = id, target = shopId) =>
    request(app.getHttpServer())
      .delete(`/api/v1/shops/${target}/categories/${resource}`)
      .set('Authorization', 'Bearer valid');
  const visibility = (
    body: unknown = { isVisible: true, expectedVisibility: false },
    resource = id,
    target = shopId,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${target}/categories/${resource}/visibility`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to show/hide without touching category details or products',
    async (allowed) => {
      role = allowed;
      const response = await visibility().expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.category).toMatchObject({
        ...original,
        isVisible: true,
        createdAt: original.createdAt.toISOString(),
      });
      expect(update.mock.calls[0][0]).toMatchObject({
        where: {
          id,
          shopId,
          isVisible: false,
          shop: {
            id: shopId,
            isActive: true,
            members: {
              some: {
                disabledAt: null,
                userId,
                role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
                user: { isActive: true },
              },
            },
          },
        },
        data: { isVisible: true },
      });
      await visibility({ isVisible: false, expectedVisibility: true }).expect(
        200,
      );
      expect(update.mock.calls[1][0].data).toEqual({ isVisible: false });
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s visibility updates',
    async (denied) => {
      role = denied;
      await visibility().expect(403);
      expect(update).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { isVisible: true },
    { isVisible: 'false', expectedVisibility: false },
    { isVisible: 0, expectedVisibility: false },
    { isVisible: null, expectedVisibility: false },
    { isVisible: false, expectedVisibility: 'true' },
    { isVisible: false, expectedVisibility: true, shopId: otherShop },
    { isVisible: false, expectedVisibility: true, name: 'Injected' },
  ])('rejects invalid visibility input (%j)', async (body) => {
    await visibility(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects foreign categories, mixed IDs, malformed IDs and unauthenticated visibility writes', async () => {
    await visibility(undefined, foreign).expect(404);
    await visibility(undefined, id, otherShop).expect(404);
    await visibility(undefined, 'bad').expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/categories/${id}/visibility`)
      .send({ isVisible: true, expectedVisibility: false })
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });
  const missingWrite = () =>
    new Prisma.PrismaClientKnownRequestError('changed', {
      code: 'P2025',
      clientVersion: 'test',
    });
  it('returns a conflict when the visibility source state changed', async () => {
    update.mockRejectedValue(missingWrite());
    const response = await visibility().expect(409);
    expect(response.body.code).toBe('CATEGORY_VISIBILITY_CHANGED');
  });
  it('rechecks membership after a denied visibility write', async () => {
    update.mockImplementation(async () => {
      role = 'CASHIER';
      throw missingWrite();
    });
    await visibility().expect(403);
  });
  it('handles a category deleted before the visibility write safely', async () => {
    update.mockImplementation(async () => {
      findCategory.mockResolvedValue(null);
      throw missingWrite();
    });
    await visibility().expect(404);
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to delete with live tenant and role predicates',
    async (allowed) => {
      role = allowed;
      const response = await remove().expect(204);
      expect(response.text).toBe('');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(deleteRecord).toHaveBeenCalledWith({
        where: {
          id,
          shopId,
          shop: {
            id: shopId,
            isActive: true,
            members: {
              some: {
                disabledAt: null,
                userId,
                role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
                user: { isActive: true },
              },
            },
          },
        },
        select: { id: true },
      });
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s deletion before business logic',
    async (denied) => {
      role = denied;
      await remove().expect(403);
      expect(deleteRecord).not.toHaveBeenCalled();
    },
  );
  it('denies mixed tenant/resource IDs without deleting anything', async () => {
    await remove(foreign).expect(404);
    await remove(id, otherShop).expect(404);
    expect(deleteRecord).not.toHaveBeenCalled();
  });
  it('rejects deletion bodies and malformed IDs', async () => {
    await remove()
      .send({ shopId: otherShop, deleteProducts: true })
      .expect(400);
    await remove('bad-id').expect(400);
    expect(deleteRecord).not.toHaveBeenCalled();
  });
  it('denies guests on deletion', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/shops/${shopId}/categories/${id}`)
      .expect(401);
    expect(deleteRecord).not.toHaveBeenCalled();
  });
  it('denies deleted resources and lost write-time permission safely', async () => {
    deleteRecord.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('lost', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    const response = await remove().expect(404);
    expect(response.body.code).toBe('RESOURCE_NOT_ACCESSIBLE');
    findCategory.mockResolvedValue(null);
    deleteRecord.mockClear();
    await remove().expect(404);
    expect(deleteRecord).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'lets %s edit allowed fields while retaining identity and defaults',
    async (allowed) => {
      role = allowed;
      const response = await patch({
        name: ' Drinks ',
        description: ' Freshly brewed ',
      }).expect(200);
      expect(response.body.category).toMatchObject({
        ...original,
        createdAt: original.createdAt.toISOString(),
        name: 'Drinks',
        description: 'Freshly brewed',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id,
            shopId,
            shop: expect.objectContaining({
              id: shopId,
              members: {
                some: {
                  disabledAt: null,
                  userId,
                  role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
                  user: { isActive: true },
                },
              },
            }),
          }),
          data: { name: 'Drinks', description: 'Freshly brewed' },
        }),
      );
    },
  );
  it('clears description without altering name or slug', async () => {
    await patch({ description: ' ' }).expect(200);
    expect(update.mock.calls[0][0].data).toEqual({ description: null });
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'blocks %s before resource logic',
    async (denied) => {
      role = denied;
      await patch().expect(403);
      expect(findCategory).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { name: '' },
    { name: ' ' },
    { name: null },
    { name: 42 },
    { name: 'x'.repeat(81) },
    { description: null },
    { description: 42 },
    { description: 'x'.repeat(501) },
    { slug: 'changed' },
    { shopId: otherShop },
    { sortOrder: 2 },
    { isVisible: true },
  ])('rejects invalid or privileged data (%j)', async (body) => {
    await patch(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects mixed shop/resource IDs even for a member of both shops', async () => {
    await patch({ name: 'Wrong' }, foreign).expect(404);
    await patch({ name: 'Wrong' }, id, otherShop).expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects malformed resource IDs and guests', async () => {
    await patch({ name: 'Wrong' }, 'bad').expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/categories/${id}`)
      .send({ name: 'Wrong' })
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('fails safely when permission or resource is lost before the write', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('lost', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    const response = await patch().expect(404);
    expect(response.body.code).toBe('RESOURCE_NOT_ACCESSIBLE');
  });
});
