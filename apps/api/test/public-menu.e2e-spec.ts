import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('public menu visibility', () => {
  let app: INestApplication<App>;
  const findShop = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { findFirst: findShop } })
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
  });
  it('allows public access while constraining every nested query to the resolved shop and visibility', async () => {
    findShop.mockResolvedValueOnce({ id: 'shop-a' }).mockResolvedValueOnce({
      name: 'Cafe',
      slug: 'cafe',
      description: null,
      categories: [],
      products: [
        {
          id: 'product',
          categoryId: null,
          name: 'Coffee',
          slug: 'coffee',
          description: null,
          price: new Prisma.Decimal('10'),
          imageUrl: null,
          status: 'SOLD_OUT',
          isFeatured: false,
          sortOrder: 0,
        },
      ],
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/menu/cafe')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.shop).toEqual({
      name: 'Cafe',
      slug: 'cafe',
      description: null,
    });
    expect(response.body.products[0].price).toBe('10.00');
    expect(findShop.mock.calls[0][0]).toEqual({
      where: { slug: 'cafe', isActive: true },
      select: { id: true },
    });
    expect(findShop.mock.calls[1][0]).toMatchObject({
      where: { id: 'shop-a', slug: 'cafe', isActive: true },
      select: {
        categories: { where: { shopId: 'shop-a', isVisible: true } },
        products: {
          where: {
            shopId: 'shop-a',
            status: { in: ['AVAILABLE', 'SOLD_OUT'] },
            isArchived: false,
            OR: [
              { categoryId: null },
              { category: { shopId: 'shop-a', isVisible: true } },
            ],
          },
        },
      },
    });
    expect(Object.keys(findShop.mock.calls[1][0].select).sort()).toEqual([
      'categories',
      'description',
      'name',
      'products',
      'slug',
    ]);
  });
  it('does not reveal missing or inactive shops', async () => {
    findShop.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/api/v1/menu/missing').expect(404);
    expect(findShop).toHaveBeenCalledTimes(1);
  });
  it('handles shop deactivation between slug resolution and menu read', async () => {
    findShop
      .mockResolvedValueOnce({ id: 'shop-a' })
      .mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get('/api/v1/menu/cafe').expect(404);
  });
  it.each(['Invalid', 'bad_slug', 'x'.repeat(101)])(
    'rejects malformed slug %s without a database lookup',
    async (slug) => {
      await request(app.getHttpServer())
        .get(`/api/v1/menu/${slug}`)
        .expect(404);
      expect(findShop).not.toHaveBeenCalled();
    },
  );
});
