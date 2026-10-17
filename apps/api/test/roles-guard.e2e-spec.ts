import {
  Controller,
  Get,
  UseGuards,
  Req,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';
import { ShopMembersModule } from '../src/modules/shop-members/shop-members.module.js';
import { Roles } from '../src/modules/shop-members/decorators/roles.decorator.js';
import { RolesGuard } from '../src/modules/shop-members/guards/roles.guard.js';
import type { ShopMemberRequest } from '../src/modules/shop-members/guards/shop-membership.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';

// Test-only routes exercise decorator composition; no business endpoints added.
@Controller('roles-test/:shopId')
@UseGuards(JwtAuthGuard)
@Roles('OWNER', 'ADMIN')
class RoleFixtureController {
  @Get('administration')
  inherited(@Req() req: ShopMemberRequest) {
    return req.shopMembership;
  }

  @Get('daily')
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  daily(@Req() req: ShopMemberRequest) {
    return req.shopMembership;
  }

  @Get('counter')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'CASHIER')
  counter(@Req() req: ShopMemberRequest) {
    return req.shopMembership;
  }

  @Get('preparation')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'KITCHEN')
  preparation(@Req() req: ShopMemberRequest) {
    return req.shopMembership;
  }

  @Get('cashier-only')
  @Roles('CASHIER')
  cashierOnly() {
    return { allowed: true };
  }

  @Get('empty')
  @Roles()
  empty() {
    return { allowed: true };
  }

  @Get('invalid')
  @Roles('SUPER_ADMIN' as ShopRole)
  invalid() {
    return { allowed: true };
  }
}

@Controller('roles-missing/:shopId')
@UseGuards(JwtAuthGuard, RolesGuard)
class MissingPolicyController {
  @Get()
  missing() {
    return { allowed: true };
  }
}

describe('RolesGuard HTTP enforcement', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShopId = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const currentUser = vi.fn();
  const findUnique = vi.fn();
  let role: ShopRole;
  let present: boolean;
  let userActive: boolean;
  let shopActive: boolean;
  let disabledAt: Date | null;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, AuthModule, ShopMembersModule],
      controllers: [RoleFixtureController, MissingPolicyController],
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
    role = 'ADMIN';
    present = true;
    userActive = true;
    shopActive = true;
    disabledAt = null;
    currentUser.mockImplementation(async (token: string) => {
      if (token === 'revoked') throw invalidSession();
      return { id: userId, memberships: [{ shopId, role: 'OWNER' }] };
    });
    findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_shopId: { userId: string; shopId: string } };
      }) => {
        const target = where.userId_shopId;
        if (!present || target.userId !== userId || target.shopId !== shopId)
          return null;
        return {
          id: 'live-member',
          disabledAt,
          shopId,
          role,
          user: { isActive: userActive },
          shop: {
            id: shopId,
            name: 'Cafe',
            slug: 'cafe',
            isActive: shopActive,
          },
        };
      },
    );
  });
  const get = (action = 'daily', target = shopId, token = 'valid') =>
    request(app.getHttpServer())
      .get(`/api/v1/roles-test/${target}/${action}`)
      .set('Authorization', `Bearer ${token}`);

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'denies suspended %s across business routes despite cached owner claims',
    async (suspendedRole) => {
      role = suspendedRole;
      disabledAt = new Date();
      for (const route of [
        'administration',
        'daily',
        'counter',
        'preparation',
        'cashier-only',
      ])
        await get(route).expect(404);
    },
  );

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN'] as const)(
    'enforces the route matrix for %s',
    async (currentRole) => {
      role = currentRole;
      const routes: [string, readonly ShopRole[]][] = [
        ['administration', ['OWNER', 'ADMIN']],
        ['daily', ['OWNER', 'ADMIN', 'MANAGER']],
        ['counter', ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']],
        ['preparation', ['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN']],
      ];
      for (const [action, allowed] of routes) {
        const response = await get(action).expect(
          allowed.includes(role) ? 200 : 403,
        );
        if (allowed.includes(role))
          expect(response.body).toMatchObject({ shopId, role });
        else expect(response.body.code).toBe('SHOP_ROLE_REQUIRED');
      }
    },
  );

  it('does not let OWNER bypass an exact CASHIER allowlist', async () => {
    role = 'OWNER';
    await get('cashier-only').expect(403);
    role = 'CASHIER';
    await get('cashier-only').expect(200);
  });

  it('denies access after a live role downgrade despite cached OWNER claims', async () => {
    await get('daily').expect(200);
    role = 'KITCHEN';
    await get('daily').expect(403);
  });

  it('denies removed membership on the next request', async () => {
    await get().expect(200);
    present = false;
    await get().expect(404);
  });

  it.each(['user', 'shop'])('denies an inactive %s', async (target) => {
    if (target === 'user') userActive = false;
    else shopActive = false;
    await get().expect(404);
  });

  it('does not fall back to a shop/role provided in headers or queries', async () => {
    await get('daily', otherShopId)
      .set('X-Shop-Id', shopId)
      .query({ shopId, role: 'OWNER' })
      .expect(404);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_shopId: { userId, shopId: otherShopId } },
      }),
    );
  });

  it('rejects malformed shop IDs before database access', async () => {
    await get('daily', 'not-a-uuid').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('denies guests before membership lookup', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/roles-test/${shopId}/daily`)
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('denies revoked sessions before membership lookup', async () => {
    await get('daily', shopId, 'revoked').expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['empty', 'invalid'])(
    'denies a %s policy even with a valid role',
    async (action) => {
      role = 'OWNER';
      const response = await get(action).expect(403);
      expect(response.body.code).toBe('SHOP_ROLE_POLICY_REQUIRED');
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('fails closed when RolesGuard has no decorator policy', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/roles-missing/${shopId}`)
      .set('Authorization', 'Bearer valid')
      .expect(403);
    expect(response.body.code).toBe('SHOP_ROLE_POLICY_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
