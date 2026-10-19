import { resetRateLimits } from './rate-limit-test-utils.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';

describe('ShopMember tenant access', () => {
  let app: INestApplication<App>;
  const userA = '75992537-5d60-4d22-8e1e-60a114644681';
  const userB = 'c86f02c5-339a-4670-b868-ef4abf2288cf';
  const shopA = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const shopB = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const unknownShop = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn();
  const findUnique = vi.fn();
  function record(userId: string, shopId: string, role: ShopRole) {
    return {
      id: `${userId}:${shopId}`,
      userId,
      shopId,
      role,
      user: { isActive: true, passwordHash: 'private' },
      shop: {
        id: shopId,
        name: shopId === shopA ? 'Cafe A' : 'Cafe B',
        slug: shopId === shopA ? 'cafe-a' : 'cafe-b',
        isActive: true,
      },
    };
  }
  const memberships = new Map<string, ReturnType<typeof record>>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shopMember: { findUnique } })
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
    resetRateLimits(app);
    vi.resetAllMocks();
    memberships.clear();
    memberships.set(`${userA}:${shopA}`, record(userA, shopA, 'OWNER'));
    memberships.set(`${userA}:${shopB}`, record(userA, shopB, 'CASHIER'));
    memberships.set(`${userB}:${shopA}`, record(userB, shopA, 'KITCHEN'));
    currentUser.mockImplementation(async (token: string) => {
      if (token === 'revoked') throw invalidSession();
      return { id: token === 'user-b-token' ? userB : userA, memberships: [] };
    });
    findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_shopId: { userId: string; shopId: string } };
      }) => {
        const { userId, shopId } = where.userId_shopId;
        return memberships.get(`${userId}:${shopId}`) ?? null;
      },
    );
  });
  const get = (shopId: string, token = 'user-a-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/membership`)
      .set('Authorization', `Bearer ${token}`);

  it('returns the current user’s own membership, without credentials or other users', async () => {
    const response = await get(shopA).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      membership: {
        id: `${userA}:${shopA}`,
        shopId: shopA,
        role: 'OWNER',
        shop: { id: shopA, name: 'Cafe A', slug: 'cafe-a', isActive: true },
      },
    });
    expect(response.text).not.toContain('passwordHash');
    expect(response.text).not.toContain(userB);
  });

  it('allows the same user to have different roles in different shops', async () => {
    expect((await get(shopA).expect(200)).body.membership.role).toBe('OWNER');
    expect((await get(shopB).expect(200)).body.membership.role).toBe('CASHIER');
  });

  it('allows multiple users in one shop without sharing roles', async () => {
    expect(
      (await get(shopA, 'user-b-token').expect(200)).body.membership.role,
    ).toBe('KITCHEN');
    expect((await get(shopA).expect(200)).body.membership.role).toBe('OWNER');
  });

  it('denies cross-shop access even when the user belongs to another shop', async () => {
    const forbidden = await get(shopB, 'user-b-token').expect(404);
    const missing = await get(unknownShop, 'user-b-token').expect(404);
    expect(forbidden.body).toEqual(missing.body);
    expect(forbidden.body.code).toBe('SHOP_NOT_ACCESSIBLE');
  });

  it('uses the signed-in identity instead of client-supplied user or role values', async () => {
    const response = await get(shopA, 'user-b-token')
      .query({ userId: userA, role: 'OWNER' })
      .expect(200);
    expect(response.body.membership.role).toBe('KITCHEN');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_shopId: { userId: userB, shopId: shopA } },
      }),
    );
  });

  it('re-reads role changes without relying on cached session memberships', async () => {
    await get(shopA).expect(200);
    memberships.get(`${userA}:${shopA}`)!.role = 'MANAGER';
    expect((await get(shopA).expect(200)).body.membership.role).toBe('MANAGER');
  });

  it('denies removed membership on the next request', async () => {
    await get(shopA).expect(200);
    memberships.delete(`${userA}:${shopA}`);
    await get(shopA).expect(404);
  });

  it('denies access when the shop is inactive', async () => {
    memberships.get(`${userA}:${shopA}`)!.shop.isActive = false;
    await get(shopA).expect(404);
  });

  it('denies access when the linked user is inactive', async () => {
    memberships.get(`${userA}:${shopA}`)!.user.isActive = false;
    await get(shopA).expect(404);
  });

  it('rejects guests before querying memberships', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopA}/membership`)
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects revoked sessions before querying memberships', async () => {
    await get(shopA, 'revoked').expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed shop IDs before querying memberships', async () => {
    const response = await get('not-a-uuid').expect(400);
    expect(response.body.code).toBe('INVALID_SHOP_ID');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not expose database failures', async () => {
    findUnique.mockRejectedValue(new Error('Private connection information'));
    const response = await get(shopA).expect(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.text).not.toContain('Private');
  });
});
