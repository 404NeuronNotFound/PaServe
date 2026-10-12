import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { TableContextService } from '../src/modules/tables/table-context.service.js';

describe('public table menus', () => {
  let app: INestApplication<App>;
  const findTable = vi.fn(),
    findShop = vi.fn();
  const code = 't_9dd21e8326b440b2a73f22d4f16c038a';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        restaurantTable: { findFirst: findTable },
        shop: { findFirst: findShop },
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
    findTable.mockImplementation(async ({ where }) =>
      where.shop.slug === 'cafe' && [code, 'T12'].includes(where.code)
        ? { code: where.code, number: 'Patio 4', shop: { slug: 'cafe' } }
        : null,
    );
    findShop.mockResolvedValueOnce({ id: 'shop-a' }).mockResolvedValue({
      name: 'Cafe',
      slug: 'cafe',
      categories: [],
      products: [],
    });
  });
  const get = (slug = 'cafe', token = code) =>
    request(app.getHttpServer()).get(
      `/api/v1/menu/${slug}/table/${encodeURIComponent(token)}`,
    );
  it.each([code, 'T12'])(
    'resolves %s without authentication or private IDs',
    async (token) => {
      const response = await get('cafe', token).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.table).toEqual({
        shopSlug: 'cafe',
        code: token,
        number: 'Patio 4',
        checkoutToken: expect.any(String),
      });
      new TableContextService(new ConfigService()).verify(
        response.body.table.checkoutToken,
        'cafe',
        token,
      );
      expect(response.body.shop.slug).toBe('cafe');
      expect(JSON.stringify(response.body)).not.toContain('shop-a');
      expect(findTable).toHaveBeenCalledWith({
        where: {
          code: token,
          isActive: true,
          shop: { slug: 'cafe', isActive: true },
        },
        select: { code: true, number: true, shop: { select: { slug: true } } },
      });
      expect(findShop.mock.calls[0][0].where).toEqual({
        slug: 'cafe',
        isActive: true,
        tables: { some: { code: token, isActive: true } },
      });
      expect(findShop.mock.calls[1][0].where).toEqual({
        id: 'shop-a',
        slug: 'cafe',
        isActive: true,
        tables: { some: { shopId: 'shop-a', code: token, isActive: true } },
      });
      expect(findShop.mock.calls[1][0].select.products.where.shopId).toBe(
        'shop-a',
      );
    },
  );
  it.each(['T999', '75992537-5d60-4d22-8e1e-60a114644681', 'T12?x=1', 'T12\n'])(
    'rejects unknown/unsafe code %j',
    async (token) => {
      await get('cafe', token).expect(404);
      expect(findShop).not.toHaveBeenCalled();
    },
  );
  it('cannot resolve another shop code in this shop', async () => {
    await get('other', code).expect(404);
    expect(findShop).not.toHaveBeenCalled();
  });
  it('returns unavailable for inactive shop/table predicates', async () => {
    findTable.mockResolvedValue(null);
    await get().expect(404);
    expect(findShop).not.toHaveBeenCalled();
  });
  it('rechecks a table deactivated between lookup and menu read', async () => {
    findShop.mockReset().mockResolvedValue(null);
    await get().expect(404);
  });
  it('rechecks a shop deactivated between the two menu reads', async () => {
    findShop
      .mockReset()
      .mockResolvedValueOnce({ id: 'shop-a' })
      .mockResolvedValueOnce(null);
    await get().expect(404);
  });
});
