import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { requestValidationPipe } from '../src/common/pipes/request-validation.pipe.js';

const productId = '10000000-0000-4000-8000-000000000001';
const groupId = '10000000-0000-4000-8000-000000000002';
const regularId = '10000000-0000-4000-8000-000000000003';
const largeId = '10000000-0000-4000-8000-000000000004';
const addOnId = '10000000-0000-4000-8000-000000000005';
const foreignId = '10000000-0000-4000-8000-000000000006';
const path = `/api/v1/menu/cafe/products/${productId}`;
const fixture = () => ({
  id: productId,
  categoryId: null,
  name: 'Coffee',
  slug: 'coffee',
  description: 'Fresh coffee',
  price: new Prisma.Decimal('120.01'),
  imageUrl: null,
  status: 'AVAILABLE',
  isFeatured: false,
  sortOrder: 0,
  featuredSortOrder: 0,
  optionGroups: [{ id: groupId, name: 'Size', isRequired: true }],
  variants: [
    {
      id: regularId,
      optionGroupId: groupId,
      name: 'Regular',
      priceAdjustment: new Prisma.Decimal('0'),
      isDefault: true,
    },
    {
      id: largeId,
      optionGroupId: groupId,
      name: 'Large',
      priceAdjustment: new Prisma.Decimal('30.10'),
      isDefault: false,
    },
  ],
  addOns: [
    {
      addOn: {
        id: addOnId,
        name: 'Oat milk',
        priceAdjustment: new Prisma.Decimal('25.20'),
      },
    },
  ],
});
describe('public product details and selection quotes', () => {
  let app: INestApplication<App>;
  const shop = vi.fn();
  const product = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ shop: { findFirst: shop }, product: { findFirst: product } })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(requestValidationPipe());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    shop.mockResolvedValue({ id: 'shop-a' });
    product.mockResolvedValue(fixture());
  });
  it('loads fresh public details with scoped available options without authentication', async () => {
    const response = await request(app.getHttpServer()).get(path).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.product).toMatchObject({
      id: productId,
      price: '120.01',
      isOrderable: true,
    });
    expect(response.body.variants[1].priceAdjustment).toBe('30.10');
    expect(response.body.addOns).toEqual([
      { id: addOnId, name: 'Oat milk', priceAdjustment: '25.20' },
    ]);
    expect(product.mock.calls[0][0]).toMatchObject({
      where: {
        id: productId,
        shopId: 'shop-a',
        isArchived: false,
        status: { in: ['AVAILABLE', 'SOLD_OUT'] },
        shop: { id: 'shop-a', slug: 'cafe', isActive: true },
        OR: [
          { categoryId: null },
          { category: { shopId: 'shop-a', isVisible: true } },
        ],
      },
      select: {
        optionGroups: {
          where: { shopId: 'shop-a', productId, isAvailable: true },
        },
        variants: {
          where: {
            shopId: 'shop-a',
            productId,
            isAvailable: true,
            OR: [
              { optionGroupId: null },
              {
                optionGroup: { shopId: 'shop-a', productId, isAvailable: true },
              },
            ],
          },
        },
        addOns: {
          where: {
            shopId: 'shop-a',
            productId,
            addOn: { shopId: 'shop-a', isAvailable: true },
          },
        },
      },
    });
  });
  it('quotes combined choices, quantity and plain-text notes using exact server prices', async () => {
    const response = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({
        variantIds: [largeId],
        addOnIds: [addOnId],
        quantity: 3,
        notes: '  <b>No sugar</b>\r\nPlease  ',
      })
      .expect(201);
    expect(response.body).toMatchObject({
      basePrice: '120.01',
      unitPrice: '175.31',
      totalPrice: '525.93',
      quantity: 3,
      notes: '<b>No sugar</b>\nPlease',
      currency: 'PHP',
    });
  });
  it('uses changed server prices at the next quote', async () => {
    product.mockResolvedValue({
      ...fixture(),
      price: new Prisma.Decimal('125.01'),
    });
    const response = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId], addOnIds: [], quantity: 2 })
      .expect(201);
    expect(response.body.totalPrice).toBe('250.02');
  });
  it.each(['variant', 'add-on'])(
    'rejects a %s that becomes unavailable after details load',
    async (kind) => {
      await request(app.getHttpServer()).get(path).expect(200);
      const current = fixture();
      if (kind === 'variant') current.variants = [current.variants[0]];
      else current.addOns = [];
      product.mockResolvedValue(current);
      const response = await request(app.getHttpServer())
        .post(`${path}/quote`)
        .send({
          variantIds: [largeId],
          addOnIds: [addOnId],
          quantity: 1,
        })
        .expect(400);
      expect(response.body.code).toBe('PRODUCT_SELECTION_INVALID');
      expect(product).toHaveBeenCalledTimes(2);
    },
  );
  it('supports optional groups and products without customization', async () => {
    product.mockResolvedValue({
      ...fixture(),
      optionGroups: [],
      variants: [],
      addOns: [],
    });
    const response = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [], addOnIds: [], quantity: 1 })
      .expect(201);
    expect(response.body.unitPrice).toBe('120.01');
    product.mockResolvedValue({
      ...fixture(),
      optionGroups: [{ id: groupId, name: 'Size', isRequired: false }],
    });
    await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [], addOnIds: [], quantity: 1 })
      .expect(201);
  });
  it('blocks required groups with no available choices', async () => {
    product.mockResolvedValue({ ...fixture(), variants: [] });
    await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [], addOnIds: [], quantity: 1 })
      .expect(400);
  });
  it('limits ungrouped variants to one choice', async () => {
    product.mockResolvedValue({
      ...fixture(),
      optionGroups: [],
      variants: fixture().variants.map((variant) => ({
        ...variant,
        optionGroupId: null,
      })),
    });
    await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId, largeId], addOnIds: [], quantity: 1 })
      .expect(400);
  });
  it('handles free add-ons and large exact quantity totals', async () => {
    const data = fixture();
    data.price = new Prisma.Decimal('99999999.99');
    data.addOns[0].addOn.priceAdjustment = new Prisma.Decimal('0');
    product.mockResolvedValue(data);
    const response = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId], addOnIds: [addOnId], quantity: 99 })
      .expect(201);
    expect(response.body.totalPrice).toBe('9899999999.01');
    expect(response.body.addOns[0].priceAdjustment).toBe('0.00');
  });
  it.each([50, 51])(
    'enforces the add-on selection boundary for %i choices',
    async (count) => {
      const current = fixture();
      current.addOns = Array.from({ length: count }, (_, index) => ({
        addOn: {
          id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: `Extra ${index}`,
          priceAdjustment: new Prisma.Decimal('0.01'),
        },
      }));
      product.mockResolvedValue(current);
      const response = await request(app.getHttpServer())
        .post(`${path}/quote`)
        .send({
          variantIds: [regularId],
          addOnIds: current.addOns.map(({ addOn }) => addOn.id),
          quantity: 2,
        })
        .expect(count === 50 ? 201 : 400);
      if (count === 50) {
        expect(response.body.addOns).toHaveLength(50);
        expect(response.body.unitPrice).toBe('120.51');
        expect(response.body.totalPrice).toBe('241.02');
      } else expect(product).not.toHaveBeenCalled();
    },
  );
  it.each([
    { variantIds: [], addOnIds: [], quantity: 1 },
    { variantIds: [regularId, largeId], addOnIds: [], quantity: 1 },
    { variantIds: [foreignId], addOnIds: [], quantity: 1 },
    { variantIds: [regularId], addOnIds: [foreignId], quantity: 1 },
  ])('rejects missing, conflicting or foreign selections: %j', async (body) => {
    const response = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send(body)
      .expect(400);
    expect(response.body.code).toBe('PRODUCT_SELECTION_INVALID');
  });
  it.each([
    { quantity: 0 },
    { quantity: 100 },
    { quantity: 1.5 },
    { quantity: '2' },
    { unitPrice: '0.01' },
    { variantIds: [regularId, regularId] },
    { addOnIds: [addOnId, addOnId] },
    { notes: 'x'.repeat(301) },
    { notes: '\u202eunsafe' },
    { notes: null },
  ])('validates the selection request: %j', async (change) => {
    await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId], addOnIds: [], quantity: 1, ...change })
      .expect(400);
  });
  it('allows sold-out inspection but rejects quotes', async () => {
    product.mockResolvedValue({ ...fixture(), status: 'SOLD_OUT' });
    const response = await request(app.getHttpServer()).get(path).expect(200);
    expect(response.body.product.isOrderable).toBe(false);
    await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId], addOnIds: [], quantity: 1 })
      .expect(404);
  });
  it('rejects a product that sells out after details were loaded', async () => {
    const initial = await request(app.getHttpServer()).get(path).expect(200);
    expect(initial.body.product.isOrderable).toBe(true);
    product.mockResolvedValue({ ...fixture(), status: 'SOLD_OUT' });
    const rejected = await request(app.getHttpServer())
      .post(`${path}/quote`)
      .send({ variantIds: [regularId], addOnIds: [addOnId], quantity: 1 })
      .expect(404);
    expect(rejected.body.code).toBe('PRODUCT_NOT_AVAILABLE');
    expect(product).toHaveBeenCalledTimes(2);
    const refreshed = await request(app.getHttpServer()).get(path).expect(200);
    expect(refreshed.body.product).toMatchObject({
      status: 'SOLD_OUT',
      isOrderable: false,
    });
  });
  it('does not expose missing, hidden, archived, or foreign products', async () => {
    product.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get(path).expect(404);
    expect(response.body.message).toBe('This product is unavailable.');
  });
  it('does not read products from an inactive or missing shop', async () => {
    shop.mockResolvedValue(null);
    await request(app.getHttpServer()).get(path).expect(404);
    expect(product).not.toHaveBeenCalled();
  });
  it('rejects malformed slugs without lookup', async () => {
    await request(app.getHttpServer())
      .get(path.replace('/cafe/', '/bad_slug/'))
      .expect(404);
    expect(shop).not.toHaveBeenCalled();
  });
});
