import {
  Controller,
  Get,
  Patch,
  Req,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TenancyModule } from '../src/modules/tenancy/tenancy.module.js';
import {
  ShopResource,
  type ShopResourceRequest,
} from '../src/modules/tenancy/shop-resource.guard.js';
import { Roles } from '../src/modules/shop-members/decorators/roles.decorator.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { invalidSession } from '../src/modules/auth/tokens.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

const businessAction = vi.fn();
@Controller('tenant-test/:shopId')
class ResourceFixtureController {
  @Get('products/:resourceId')
  @ShopResource('product', 'resourceId')
  product(@Req() req: ShopResourceRequest) {
    return req.shopResource;
  }

  @Get('categories/:resourceId')
  @ShopResource('category', 'resourceId')
  category(@Req() req: ShopResourceRequest) {
    return req.shopResource;
  }

  @Patch('products/:resourceId')
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @ShopResource('product', 'resourceId')
  update(@Req() req: ShopResourceRequest) {
    return businessAction(req.shopResource);
  }
}

describe('shop/resource ID isolation through HTTP', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopA = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const shopB = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const productA = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const productB = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const categoryA = 'c47f6994-a303-4a7b-87b0-2386d5198828';
  const categoryB = 'd47f6994-a303-4a7b-87b0-2386d5198828';
  const missingId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const currentUser = vi.fn();
  const findMembership = vi.fn();
  const findProduct = vi.fn();
  const findCategory = vi.fn();
  let memberA: boolean;
  let memberB: boolean;
  let active: boolean;
  let role: string;
  const rows = new Map([
    [productA, shopA],
    [productB, shopB],
    [categoryA, shopA],
    [categoryB, shopB],
  ]);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, TenancyModule],
      controllers: [ResourceFixtureController],
    })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: findMembership },
        product: { findFirst: findProduct },
        category: { findFirst: findCategory },
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
    memberA = true;
    memberB = true;
    active = true;
    role = 'OWNER';
    currentUser.mockImplementation(async (token: string) => {
      if (token === 'revoked') throw invalidSession();
      return { id: userId, memberships: [{ shopId: shopB, role: 'OWNER' }] };
    });
    findMembership.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_shopId: { userId: string; shopId: string } };
      }) => {
        const target = where.userId_shopId;
        if (
          target.userId !== userId ||
          !(target.shopId === shopA
            ? memberA
            : target.shopId === shopB && memberB)
        )
          return null;
        return {
          id: `member-${target.shopId}`,
          shopId: target.shopId,
          role,
          user: { isActive: active },
          shop: {
            id: target.shopId,
            name: 'Cafe',
            slug: 'cafe',
            isActive: true,
          },
        };
      },
    );
    const lookup = async ({
      where,
    }: {
      where: {
        id: string;
        shopId: string;
        shop: { members: { some: { userId: string } } };
      };
    }) => {
      if (
        !active ||
        where.shop.members.some.userId !== userId ||
        !(where.shopId === shopA ? memberA : memberB) ||
        rows.get(where.id) !== where.shopId
      )
        return null;
      return { id: where.id, shopId: where.shopId };
    };
    findProduct.mockImplementation(lookup);
    findCategory.mockImplementation(lookup);
    businessAction.mockImplementation((resource) => resource);
  });
  const get = (kind: string, id: string, target = shopA, token = 'valid') =>
    request(app.getHttpServer())
      .get(`/api/v1/tenant-test/${target}/${kind}/${id}`)
      .set('Authorization', `Bearer ${token}`);

  it.each([
    ['products', productA, productB],
    ['categories', categoryA, categoryB],
  ])(
    'rejects another shop’s valid %s ID even when a member of both shops',
    async (kind, own, foreign) => {
      await get(kind, own).expect(200);
      const other = await get(kind, foreign).expect(404);
      const missing = await get(kind, missingId).expect(404);
      expect(other.body).toEqual(missing.body);
      expect(other.body.code).toBe('RESOURCE_NOT_ACCESSIBLE');
      await get(kind, foreign, shopB).expect(200);
    },
  );

  it('rejects an unauthorized shop URL before looking up even a valid resource', async () => {
    memberB = false;
    await get('products', productB, shopB).expect(404);
    expect(findProduct).not.toHaveBeenCalled();
  });

  it('ignores forged shop hints when resolving a valid foreign ID', async () => {
    await get('products', productB)
      .set('X-Shop-Id', shopB)
      .query({ shopId: shopB, role: 'OWNER' })
      .expect(404);
    expect(findProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: productB, shopId: shopA }),
      }),
    );
  });

  it('blocks business mutation on a foreign product and does not accept body shop changes', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/tenant-test/${shopA}/products/${productB}`)
      .set('Authorization', 'Bearer valid')
      .send({ shopId: shopB })
      .expect(404);
    expect(businessAction).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch(`/api/v1/tenant-test/${shopA}/products/${productA}`)
      .set('Authorization', 'Bearer valid')
      .send({ shopId: shopB })
      .expect(200);
    expect(businessAction).toHaveBeenCalledWith({
      id: productA,
      shopId: shopA,
      kind: 'product',
    });
  });

  it('does not grant write authority merely because a resource belongs to a member shop', async () => {
    role = 'CASHIER';
    await request(app.getHttpServer())
      .patch(`/api/v1/tenant-test/${shopA}/products/${productA}`)
      .set('Authorization', 'Bearer valid')
      .expect(403);
    expect(businessAction).not.toHaveBeenCalled();
  });

  it('rechecks live membership in the resource query after initial validation', async () => {
    const initial = {
      id: 'old',
      shopId: shopA,
      role,
      user: { isActive: true },
      shop: { id: shopA, isActive: true },
    };
    findMembership.mockImplementationOnce(async () => {
      memberA = false;
      return initial;
    });
    await get('products', productA).expect(404);
  });

  it('denies an inactive member before resource lookup', async () => {
    active = false;
    await get('categories', categoryA).expect(404);
    expect(findCategory).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', 'undefined'])(
    'rejects malformed resource IDs (%s)',
    async (id) => {
      await get('products', id).expect(400);
      expect(findProduct).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed shop IDs before tenant queries', async () => {
    await get('products', productA, 'not-a-uuid').expect(400);
    expect(findMembership).not.toHaveBeenCalled();
    expect(findProduct).not.toHaveBeenCalled();
  });

  it('rejects revoked sessions before tenant queries', async () => {
    await get('products', productA, shopA, 'revoked').expect(401);
    expect(findMembership).not.toHaveBeenCalled();
    expect(findProduct).not.toHaveBeenCalled();
  });

  it('rejects guests before tenant queries', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tenant-test/${shopA}/products/${productA}`)
      .expect(401);
    expect(findMembership).not.toHaveBeenCalled();
    expect(findProduct).not.toHaveBeenCalled();
  });
});
