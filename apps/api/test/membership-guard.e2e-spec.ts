import { Controller, Post, Req, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';
import { ShopMembersModule } from '../src/modules/shop-members/shop-members.module.js';
import { ShopMember } from '../src/modules/shop-members/decorators/shop-member.decorator.js';
import type { ShopMemberRequest } from '../src/modules/shop-members/guards/shop-membership.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';

const businessAction = vi.fn();
@Controller('membership-test/:shopId')
class MembershipFixtureController {
  @Post()
  @ShopMember()
  action(@Req() req: ShopMemberRequest) {
    return businessAction(req.user.id, req.shopMembership);
  }
}

describe('Membership Guard before business logic', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShopId = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const currentUser = vi.fn();
  const findUnique = vi.fn();
  let role: ShopRole;
  let member: boolean;
  let userActive: boolean;
  let shopActive: boolean;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, ShopMembersModule],
      controllers: [MembershipFixtureController],
    })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({ shopMember: { findUnique } })
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
    role = 'CASHIER';
    member = true;
    userActive = true;
    shopActive = true;
    currentUser.mockImplementation(async (token: string) => {
      if (token === 'revoked') throw invalidSession();
      return {
        id: userId,
        memberships: [{ shopId: otherShopId, role: 'OWNER' }],
      };
    });
    findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_shopId: { userId: string; shopId: string } };
      }) => {
        const target = where.userId_shopId;
        if (!member || target.userId !== userId || target.shopId !== shopId)
          return null;
        return {
          id: 'live-member',
          shopId,
          role,
          user: { isActive: userActive, passwordHash: 'private' },
          shop: {
            id: shopId,
            name: 'Cafe',
            slug: 'cafe',
            isActive: shopActive,
          },
        };
      },
    );
    businessAction.mockImplementation((actor, membership) => ({
      actor,
      membership,
    }));
  });
  const post = (target = shopId, token = 'valid') =>
    request(app.getHttpServer())
      .post(`/api/v1/membership-test/${target}`)
      .set('Authorization', `Bearer ${token}`);

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'allows active %s members before running the handler',
    async (liveRole) => {
      role = liveRole;
      const response = await post().expect(201);
      expect(response.body).toMatchObject({
        actor: userId,
        membership: { shopId, role },
      });
      expect(response.text).not.toContain('passwordHash');
      expect(businessAction).toHaveBeenCalledTimes(1);
      expect(currentUser.mock.invocationCallOrder[0]).toBeLessThan(
        findUnique.mock.invocationCallOrder[0],
      );
      expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
        businessAction.mock.invocationCallOrder[0],
      );
    },
  );

  it('rejects nonmembers despite forged profile, header and body membership', async () => {
    await post(otherShopId)
      .set('X-Shop-Id', shopId)
      .query({ shopId, userId, role: 'OWNER' })
      .send({
        shopId,
        role: 'OWNER',
        shopMembership: { shopId, role: 'OWNER' },
      })
      .expect(404);
    expect(businessAction).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_shopId: { userId, shopId: otherShopId } },
      }),
    );
  });

  it('blocks business logic after membership removal', async () => {
    await post().expect(201);
    businessAction.mockClear();
    member = false;
    await post().expect(404);
    expect(businessAction).not.toHaveBeenCalled();
  });

  it.each(['user', 'shop'])(
    'blocks inactive %s before business logic',
    async (target) => {
      if (target === 'user') userActive = false;
      else shopActive = false;
      await post().expect(404);
      expect(businessAction).not.toHaveBeenCalled();
    },
  );

  it('blocks guests before membership queries and business logic', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/membership-test/${shopId}`)
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(businessAction).not.toHaveBeenCalled();
  });

  it('blocks revoked sessions before membership queries and business logic', async () => {
    await post(shopId, 'revoked').expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(businessAction).not.toHaveBeenCalled();
  });

  it('blocks malformed IDs before membership queries and business logic', async () => {
    await post('not-a-uuid').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(businessAction).not.toHaveBeenCalled();
  });

  it('fails closed on a database error without leaking details or running business logic', async () => {
    findUnique.mockRejectedValue(new Error('Private connection information'));
    const response = await post().expect(500);
    expect(response.text).not.toContain('Private');
    expect(businessAction).not.toHaveBeenCalled();
  });
});
