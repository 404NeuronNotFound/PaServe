import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('tenant-scoped category creation', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const other = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const findUnique = vi.fn(),
    update = vi.fn(),
    findFirst = vi.fn(),
    currentUser = vi.fn();
  let role: string, active: boolean;
  const category = {
    id: 'category-id',
    shopId,
    name: 'Coffee',
    slug: 'coffee',
    sortOrder: 0,
    isVisible: true,
    createdAt: new Date('2026-10-09T00:00:00Z'),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({ shopMember: { findUnique }, shop: { update, findFirst } })
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
    active = true;
    currentUser.mockResolvedValue({ id: userId });
    findUnique.mockImplementation(async ({ where }) =>
      where.userId_shopId.shopId === shopId
        ? {
            id: 'member',
            shopId,
            role,
            user: { isActive: active },
            shop: { id: shopId, name: 'Cafe', slug: 'cafe', isActive: true },
          }
        : null,
    );
    update.mockResolvedValue({ categories: [category] });
    findFirst.mockResolvedValue({ categories: [category] });
  });
  const post = (body: unknown = { name: 'Coffee' }, target = shopId) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${target}/categories`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s and creates only in the validated tenant',
    async (current) => {
      role = current;
      const response = await post({ name: ' Coffee ' }).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.category).toMatchObject({
        shopId,
        name: 'Coffee',
        slug: 'coffee',
        isVisible: true,
        sortOrder: 0,
      });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
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
          data: { categories: { create: { name: 'Coffee', slug: 'coffee' } } },
          select: expect.objectContaining({
            categories: expect.objectContaining({
              where: { shopId, slug: 'coffee' },
            }),
          }),
        }),
      );
    },
  );
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s before queries or writes',
    async (current) => {
      role = current;
      await post().expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/categories`)
        .set('Authorization', 'Bearer valid')
        .expect(403);
      expect(update).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: null },
    { name: 42 },
    { name: 'x'.repeat(81) },
    { name: 'Co\u0000ffee' },
    { name: 'Coffee', shopId: other },
    { name: 'Coffee', role: 'OWNER' },
    { name: 'Coffee', slug: 'custom' },
    { name: 'Coffee', isVisible: false },
    { name: 'Coffee', sortOrder: 1 },
  ])('validates and rejects privileged fields (%j)', async (body) => {
    const response = await post(body).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects another shop URL regardless of forged hints', async () => {
    await post({ name: 'Coffee' }, other)
      .query({ shopId })
      .set('X-Shop-Id', shopId)
      .expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies malformed shop IDs and guests', async () => {
    await post({ name: 'Coffee' }, 'bad-id').expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/categories`)
      .send({ name: 'Coffee' })
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies inactive users', async () => {
    active = false;
    await post().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('returns a recoverable duplicate conflict', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const response = await post().expect(409);
    expect(response.body.code).toBe('CATEGORY_ALREADY_EXISTS');
    expect(response.body.fieldErrors.name).toBeDefined();
  });
  it('denies access lost at write time', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('lost', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    await post().expect(403);
  });
  it('lists only the validated shop and denies access lost during the read', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/categories`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(response.body.categories).toHaveLength(1);
    expect(findFirst.mock.calls[0][0].select.categories.where).toEqual({
      shopId,
    });
    findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/categories`)
      .set('Authorization', 'Bearer valid')
      .expect(403);
  });
});
