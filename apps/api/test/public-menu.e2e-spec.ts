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
        categories: {
          where: { shopId: 'shop-a', isVisible: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, slug: true, description: true, sortOrder: true },
        },
        products: {
          select: {
            id: true, categoryId: true, name: true, slug: true,
            description: true, price: true, imageUrl: true, status: true,
            isFeatured: true, featuredSortOrder: true, sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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
  it('serializes only public product fields in both the menu and Featured section', async () => {
    const product = {
      id: 'coffee', categoryId: 'drinks', name: 'Coffee', slug: 'coffee',
      description: 'Fresh coffee', price: new Prisma.Decimal('1234.50'),
      imageUrl: 'https://example.com/coffee.webp', status: 'AVAILABLE',
      isFeatured: true, featuredSortOrder: 2, sortOrder: 3,
      // Even an expanded repository projection must not leak internal fields.
      shopId: 'shop-a', isArchived: false, createdAt: new Date(),
      updatedAt: new Date(), internalNotes: 'private management data',
    };
    findShop.mockResolvedValueOnce({ id: 'shop-a' }).mockResolvedValueOnce({
      name: 'Cafe', slug: 'cafe', description: null,
      categories: [{ id: 'drinks', name: 'Drinks', slug: 'drinks', description: null, sortOrder: 0 }],
      products: [product],
    });
    const response = await request(app.getHttpServer()).get('/api/v1/menu/cafe').expect(200);
    const expected = {
      id: 'coffee', categoryId: 'drinks', name: 'Coffee', slug: 'coffee',
      description: 'Fresh coffee', price: '1234.50',
      imageUrl: 'https://example.com/coffee.webp', status: 'AVAILABLE',
      isOrderable: true, isFeatured: true, featuredSortOrder: 2, sortOrder: 3,
    };
    expect(response.body.products).toEqual([expected]);
    expect(response.body.featuredProducts).toEqual([expected]);
  });
  it.each(['cafe-a', 'cafe-b'])(
    'returns ordered public categories only for the shop resolved by %s',
    async (slug) => {
      const shopId = slug === 'cafe-a' ? 'shop-a' : 'shop-b';
      const foreignShopId = shopId === 'shop-a' ? 'shop-b' : 'shop-a';
      const categories = [
        { id: `${shopId}-desserts`, name: 'Desserts', slug: 'desserts', description: 'Fresh pastries', sortOrder: 1 },
        { id: `${shopId}-drinks`, name: 'Drinks', slug: 'drinks', description: null, sortOrder: 9 },
      ];
      const price = slug === 'cafe-a' ? '120.01' : '250.99';
      const product = {
        id: `${shopId}-coffee`, categoryId: `${shopId}-drinks`, name: 'Coffee',
        slug: 'coffee', description: null, price: new Prisma.Decimal(price),
        imageUrl: null, status: 'AVAILABLE', isFeatured: true,
        featuredSortOrder: 0, sortOrder: 0,
      };
      findShop.mockResolvedValueOnce({ id: shopId }).mockResolvedValueOnce({
        name: slug, slug, description: null, categories, products: [product],
      });
      // Client shop hints must not override the tenant resolved from the slug.
      const response = await request(app.getHttpServer())
        .get(`/api/v1/menu/${slug}?shopId=${foreignShopId}`)
        .set('X-Shop-Id', foreignShopId)
        .expect(200);
      expect(response.body.categories).toEqual(categories);
      expect(response.body.products).toEqual([{ ...product, price, isOrderable: true }]);
      expect(response.body.featuredProducts).toEqual(response.body.products);
      expect(findShop.mock.calls[0][0].where).toEqual({ slug, isActive: true });
      expect(findShop.mock.calls[1][0]).toMatchObject({
        where: { id: shopId, slug, isActive: true },
        select: {
          categories: {
            where: { shopId, isVisible: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          },
          products: { where: {
            shopId,
            OR: [{ categoryId: null }, { category: { shopId, isVisible: true } }],
          } },
        },
      });
      expect(response.body.categories.some((category) => category.id.startsWith(foreignShopId))).toBe(false);
    },
  );
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
