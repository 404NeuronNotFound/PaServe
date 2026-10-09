import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';

describe('Owner-only shop updates', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopA = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const shopB = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const missingShop = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const createdAt = new Date('2026-10-09T00:00:00Z');
  const membership = (shopId: string, role: ShopRole) => ({
    id: `member-${shopId}`,
    shopId,
    role,
    user: { isActive: true },
    shop: { id: shopId, name: 'Cafe', slug: `cafe-${shopId}`, isActive: true },
  });
  const members = new Map<string, ReturnType<typeof membership>>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { create, update }, shopMember: { findUnique } })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
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
    members.clear();
    members.set(shopA, membership(shopA, 'OWNER'));
    members.set(shopB, membership(shopB, 'CASHIER'));
    currentUser.mockImplementation(async (token: string) => {
      if (token === 'revoked') throw invalidSession();
      // Deliberately stale OWNER claim: authorization must use the join record.
      return { id: userId, memberships: [{ shopId: shopB, role: 'OWNER' }] };
    });
    findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_shopId: { userId: string; shopId: string } };
      }) =>
        where.userId_shopId.userId === userId
          ? (members.get(where.userId_shopId.shopId) ?? null)
          : null,
    );
    update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name?: string; description?: string | null };
      }) => ({
        ...members.get(where.id)!.shop,
        description: 'Original description',
        createdAt,
        ...data,
      }),
    );
    create.mockImplementation(
      async ({
        data,
      }: {
        data: { name: string; slug: string; description: string | null };
      }) => {
        const id = randomUUID();
        members.set(id, {
          ...membership(id, 'OWNER'),
          shop: { id, name: data.name, slug: data.slug, isActive: true },
        });
        return {
          id,
          name: data.name,
          slug: data.slug,
          description: data.description,
          isActive: true,
          createdAt,
          members: [{ id: `member-${id}`, shopId: id, role: 'OWNER' }],
        };
      },
    );
  });
  const patch = (
    shopId = shopA,
    body: unknown = { name: 'Updated Cafe' },
    token = 'valid-token',
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  it('allows the owner to update validated settings and preserves the slug', async () => {
    const response = await patch(shopA, {
      name: ' New Cafe ',
      description: ' Fresh coffee ',
    }).expect(200);
    expect(response.body).toEqual({
      shop: {
        id: shopA,
        name: 'New Cafe',
        slug: `cafe-${shopA}`,
        description: 'Fresh coffee',
        isActive: true,
        createdAt: createdAt.toISOString(),
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: shopA,
          isActive: true,
          members: {
            some: { userId, role: 'OWNER', user: { isActive: true } },
          },
        },
        data: { name: 'New Cafe', description: 'Fresh coffee' },
      }),
    );
  });

  it('lets a newly onboarded creator perform the protected operation', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/shops')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'New Place' })
      .expect(201);
    expect(created.body.membership.role).toBe('OWNER');
    const saved = await patch(created.body.shop.id, {
      description: 'Now open',
    }).expect(200);
    expect(saved.body.shop.description).toBe('Now open');
  });

  it('supports a partial update and clearing the description', async () => {
    const response = await patch(shopA, { description: '  ' }).expect(200);
    expect(response.body.shop.name).toBe('Cafe');
    expect(response.body.shop.description).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { description: null } }),
    );
  });

  it.each(['ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'denies %s even if cached session data claims OWNER',
    async (role) => {
      members.get(shopA)!.role = role;
      const response = await patch().expect(403);
      expect(response.body.code).toBe('OWNER_REQUIRED');
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('denies an owner of another shop who is only a cashier here', async () => {
    await patch(shopB).expect(403);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies an owner of another shop with no membership here', async () => {
    const response = await patch(missingShop).expect(404);
    expect(response.body.code).toBe('SHOP_NOT_ACCESSIBLE');
    expect(update).not.toHaveBeenCalled();
  });
  it('denies an owner after a role downgrade on the next request', async () => {
    await patch().expect(200);
    update.mockClear();
    members.get(shopA)!.role = 'MANAGER';
    await patch().expect(403);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies removed memberships on the next request', async () => {
    members.delete(shopA);
    await patch().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies inactive shops', async () => {
    members.get(shopA)!.shop.isActive = false;
    await patch().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies inactive linked users', async () => {
    members.get(shopA)!.user.isActive = false;
    await patch().expect(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('denies guests before checking ownership', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopA}`)
      .send({ name: 'Changed' })
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('denies revoked sessions before checking ownership', async () => {
    await patch(shopA, { name: 'Changed' }, 'revoked').expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects malformed shop IDs without writes', async () => {
    await patch('not-a-uuid').expect(400);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { name: '' },
    { name: '  ' },
    { name: 42 },
    { name: null },
    { name: 'x'.repeat(121) },
    { description: null },
    { description: 'x'.repeat(1001) },
    { slug: 'changed' },
    { role: 'OWNER' },
    { userId: 'other-user' },
    { isActive: false },
    { name: 'Changed', members: [] },
  ])('rejects invalid or unauthorized setting fields (%j)', async (body) => {
    const response = await patch(shopA, body).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
  it('denies a write if ownership changed after the guard ran', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('No matching owner', {
        code: 'P2025',
        clientVersion: '7.10.0',
      }),
    );
    const response = await patch().expect(403);
    expect(response.body.code).toBe('OWNER_REQUIRED');
  });
  it('keeps unexpected database failures private', async () => {
    update.mockRejectedValue(new Error('Sensitive database connection'));
    const response = await patch().expect(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.text).not.toContain('Sensitive');
  });
});
