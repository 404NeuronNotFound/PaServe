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
      logoUrl: 'https://example.com/shop/logo.webp',
      bannerUrl: 'https://example.com/shop/banner.webp',
      primaryColor: '#123456',
      accentColor: '#C9EF83',
      menuLayout: 'grid',
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
      logoUrl: 'https://example.com/shop/logo.webp',
      bannerUrl: 'https://example.com/shop/banner.webp',
      primaryColor: '#123456',
      accentColor: '#C9EF83',
      menuLayout: 'grid',
    });
    expect(response.body.products[0].price).toBe('10.00');
    expect(response.body.products[0].isOrderable).toBe(false);
    expect(response.body.featuredProducts).toEqual([]);
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
      'accentColor',
      'bannerUrl',
      'categories',
      'description',
      'logoUrl',
      'menuLayout',
      'name',
      'primaryColor',
      'products',
      'slug',
    ]);
  });
  it.each(['missing', 'inactive'])('does not reveal the %s shop', async (slug) => {
    const inactiveShop = { id: 'inactive-shop', slug: 'inactive', isActive: false };
    findShop.mockImplementation(async ({ where }) =>
      where.slug === inactiveShop.slug && where.isActive === inactiveShop.isActive
        ? inactiveShop
        : null,
    );
    const response = await request(app.getHttpServer()).get(`/api/v1/menu/${slug}`).expect(404);
    expect(response.body).toMatchObject({
      code: 'MENU_NOT_FOUND',
      message: 'This menu is unavailable.',
    });
    expect(response.body.shop).toBeUndefined();
    expect(response.body.products).toBeUndefined();
    expect(findShop).toHaveBeenCalledWith({
      where: { slug, isActive: true },
      select: { id: true },
    });
    expect(findShop).toHaveBeenCalledTimes(1);
  });
  it('derives the featured section from the eligible ordered menu without changing sold-out state', async () => {
    const make = (id: string, featured: boolean, status = 'AVAILABLE') => ({
      id,
      isFeatured: featured,
      status,
      price: new Prisma.Decimal('12.50'),
    });
    findShop.mockResolvedValueOnce({ id: 'shop-a' }).mockResolvedValueOnce({
      name: 'Cafe',
      slug: 'cafe',
      description: null,
      categories: [],
      products: [
        make('first', true),
        make('normal', false),
        make('sold', true, 'SOLD_OUT'),
      ],
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/menu/cafe')
      .expect(200);
    expect(
      response.body.featuredProducts.map((p: { id: string }) => p.id),
    ).toEqual(['first', 'sold']);
    expect(response.body.featuredProducts[1]).toMatchObject({
      status: 'SOLD_OUT',
      isOrderable: false,
      price: '12.50',
    });
    expect(response.body.products).toHaveLength(3);
  });
  it('returns independent featured order while retaining normal product order', async () => {
    const make = (
      id: string,
      sortOrder: number,
      featuredSortOrder: number,
    ) => ({
      id,
      sortOrder,
      featuredSortOrder,
      isFeatured: true,
      status: 'AVAILABLE',
      price: new Prisma.Decimal('12.50'),
    });
    findShop
      .mockResolvedValueOnce({ id: 'shop-a' })
      .mockResolvedValueOnce({
        name: 'Cafe',
        slug: 'cafe',
        description: null,
        categories: [],
        products: [make('a', 0, 1), make('b', 1, 0)],
      });
    const response = await request(app.getHttpServer())
      .get('/api/v1/menu/cafe')
      .expect(200);
    expect(response.body.products.map((item) => item.id)).toEqual(['a', 'b']);
    expect(response.body.featuredProducts.map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
  });
  it('marks an available public product as orderable', async () => {
    findShop.mockResolvedValueOnce({ id: 'shop-a' }).mockResolvedValueOnce({
      name: 'Cafe',
      slug: 'cafe',
      description: null,
      categories: [],
      products: [
        {
          id: 'product',
          status: 'AVAILABLE',
          price: new Prisma.Decimal('0.01'),
        },
      ],
    });
    const result = await request(app.getHttpServer())
      .get('/api/v1/menu/cafe')
      .expect(200);
    expect(result.body.products[0]).toMatchObject({
      isOrderable: true,
      status: 'AVAILABLE',
      price: '0.01',
    });
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
