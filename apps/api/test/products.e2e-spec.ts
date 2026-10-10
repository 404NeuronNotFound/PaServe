import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('tenant-scoped product creation', () => {
  let app: INestApplication<App>;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const other = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const categoryId = 'a47f6994-b62d-4714-b9da-78ac7929df26';
  const productId = '18e9679d-22f8-4b66-80bf-e6150b77e291';
  const membership = vi.fn(),
    shopWrite = vi.fn(),
    categoryWrite = vi.fn(),
    categoryRead = vi.fn(),
    shopRead = vi.fn(),
    currentUser = vi.fn();
  const productRead = vi.fn(),
    productWrite = vi.fn();
  let role: string;
  const product = {
    id: productId,
    shopId,
    categoryId: null,
    name: 'Latte',
    slug: 'latte',
    description: null,
    price: new Prisma.Decimal('12.50'),
    imageUrl: null,
    status: 'AVAILABLE',
    isFeatured: false,
    isArchived: false,
    sortOrder: 0,
    createdAt: new Date('2026-10-09T00:00:00Z'),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue({ currentUser })
      .overrideProvider(PrismaService)
      .useValue({
        shopMember: { findUnique: membership },
        shop: { update: shopWrite, findFirst: shopRead },
        category: { update: categoryWrite, findFirst: categoryRead },
        product: { findFirst: productRead, update: productWrite },
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
    role = 'OWNER';
    currentUser.mockResolvedValue({ id: userId });
    membership.mockImplementation(async ({ where }) => ({
      id: 'member',
      shopId: where.userId_shopId.shopId,
      role,
      user: { isActive: true },
      shop: {
        id: where.userId_shopId.shopId,
        name: 'Cafe',
        slug: 'cafe',
        isActive: true,
      },
    }));
    categoryRead.mockImplementation(async ({ where }) =>
      where.shopId === shopId && where.id === categoryId
        ? { id: categoryId, shopId }
        : null,
    );
    shopWrite.mockResolvedValue({ products: [product] });
    categoryWrite.mockResolvedValue({ products: [{ ...product, categoryId }] });
    shopRead.mockResolvedValue({ products: [product] });
    productRead.mockImplementation(async ({ where }) =>
      where.shopId === shopId && where.id === productId
        ? { id: productId, shopId }
        : null,
    );
    productWrite.mockResolvedValue({
      ...product,
      name: 'Iced latte',
      price: new Prisma.Decimal('15'),
    });
  });
  const post = (
    body: unknown = { name: 'Latte', price: '12.50' },
    target = shopId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${target}/products`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  const get = () =>
    request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/products`)
      .set('Authorization', 'Bearer valid');
  const patch = (body: unknown, shop = shopId, id = productId) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${shop}/products/${id}`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  const archive = (
    body: unknown = { isArchived: true, expectedArchived: false },
    shop = shopId,
    id = productId,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/shops/${shop}/products/${id}/archive`)
      .set('Authorization', 'Bearer valid')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s to archive with scoped conditional writes',
    async (value) => {
      role = value;
      productWrite.mockResolvedValue({ ...product, isArchived: true });
      const response = await archive().expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.product).toMatchObject({
        id: productId,
        isArchived: true,
        name: 'Latte',
        price: '12.50',
        status: 'AVAILABLE',
      });
      const query = productWrite.mock.calls[0][0];
      expect(query.where).toMatchObject({
        id: productId,
        shopId,
        isArchived: false,
        shop: {
          id: shopId,
          members: {
            some: { userId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
          },
        },
      });
      expect(query.data).toEqual({ isArchived: true });
      expect(shopWrite).not.toHaveBeenCalled();
      expect(categoryWrite).not.toHaveBeenCalled();
    },
  );
  it('restores without resetting status, category, price or slug', async () => {
    productWrite.mockResolvedValue({ ...product, status: 'HIDDEN' });
    const response = await archive({
      isArchived: false,
      expectedArchived: true,
    }).expect(200);
    expect(response.body.product.status).toBe('HIDDEN');
    expect(productWrite.mock.calls[0][0].data).toEqual({ isArchived: false });
    expect(productWrite.mock.calls[0][0].where.isArchived).toBe(true);
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s archive and restore',
    async (value) => {
      role = value;
      await archive().expect(403);
      await archive({ isArchived: false, expectedArchived: true }).expect(403);
      expect(productWrite).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { isArchived: true },
    { isArchived: 'true', expectedArchived: false },
    { isArchived: null, expectedArchived: false },
    { isArchived: true, expectedArchived: null },
    { isArchived: true, expectedArchived: 'false' },
    { isArchived: true, expectedArchived: false, shopId: other },
    { isArchived: true, expectedArchived: false, status: 'HIDDEN' },
  ])('rejects invalid archive fields (%j)', async (body) => {
    await archive(body).expect(400);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it('rejects foreign products, malformed IDs and nonmembers', async () => {
    await archive(undefined, other).expect(404);
    await archive(undefined, shopId, 'bad').expect(400);
    membership.mockResolvedValue(null);
    await archive().expect(404);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it('denies guests and does not expose destructive deletion', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/products/${productId}/archive`)
      .send({ isArchived: true, expectedArchived: false })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/shops/${shopId}/products/${productId}`)
      .set('Authorization', 'Bearer valid')
      .expect(404);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it('returns 409 for stale archive state without leaking database errors', async () => {
    productWrite.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('secret', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    const response = await archive().expect(409);
    expect(response.body.code).toBe('PRODUCT_ARCHIVE_CHANGED');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('rechecks lost role or missing resources after a conditional archive failure', async () => {
    productWrite.mockImplementation(async () => {
      role = 'CASHIER';
      throw new Prisma.PrismaClientKnownRequestError('lost', {
        code: 'P2025',
        clientVersion: 'test',
      });
    });
    await archive().expect(403);
    role = 'OWNER';
    productWrite.mockImplementation(async () => {
      productRead.mockResolvedValue(null);
      throw new Prisma.PrismaClientKnownRequestError('gone', {
        code: 'P2025',
        clientVersion: 'test',
      });
    });
    await archive().expect(404);
  });
  it('rejects archival injection through create and edit', async () => {
    await post({ name: 'Latte', price: '1', isArchived: true }).expect(400);
    await patch({ isArchived: false }).expect(400);
    expect(productWrite).not.toHaveBeenCalled();
    expect(shopWrite).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'lets %s edit only product fields, preserving slug and tenant',
    async (value) => {
      role = value;
      const response = await patch({
        name: ' Iced latte ',
        price: '15',
      }).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.product).toMatchObject({
        name: 'Iced latte',
        price: '15.00',
        slug: 'latte',
        shopId,
      });
      const query = productWrite.mock.calls[0][0];
      expect(query.where).toMatchObject({
        id: productId,
        shopId,
        shop: {
          id: shopId,
          members: {
            some: { userId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
          },
        },
      });
      expect(query.data).toEqual({ name: 'Iced latte', price: '15' });
      expect(shopWrite).not.toHaveBeenCalled();
      expect(categoryWrite).not.toHaveBeenCalled();
    },
  );
  it('assigns a same-shop category, clears optional fields and keeps false/zero', async () => {
    await patch({
      categoryId,
      description: '',
      imageUrl: '',
      isFeatured: false,
      sortOrder: 0,
      status: 'HIDDEN',
    }).expect(200);
    expect(productWrite.mock.calls[0][0].data).toMatchObject({
      category: { connect: { id: categoryId, shopId } },
      description: null,
      imageUrl: null,
      isFeatured: false,
      sortOrder: 0,
      status: 'HIDDEN',
    });
    await patch({ categoryId: null }).expect(200);
    expect(productWrite.mock.calls[1][0].data).toEqual({
      category: { disconnect: true },
    });
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s product editing before resource reads',
    async (value) => {
      role = value;
      await patch({ name: 'Changed' }).expect(403);
      expect(productRead).not.toHaveBeenCalled();
      expect(productWrite).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { name: '' },
    { name: null },
    { price: '1.001' },
    { price: -1 },
    { price: null },
    { categoryId: 'bad' },
    { status: null },
    { isFeatured: 'true' },
    { sortOrder: -1 },
    { imageUrl: 'http://example.com/a' },
    { shopId: other },
    { slug: 'changed' },
    { id: productId },
    { orderItems: [] },
  ])('rejects invalid or protected edit fields (%j)', async (body) => {
    await patch(body).expect(400);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it('rejects foreign products and foreign categories for a multi-shop actor', async () => {
    await patch({ name: 'Stolen' }, other).expect(404);
    await patch({ categoryId: other }).expect(404);
    await patch({ name: 'Changed' }, shopId, 'bad-id').expect(400);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it('rejects editing as guest or after membership removal', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/shops/${shopId}/products/${productId}`)
      .send({ price: '1' })
      .expect(401);
    membership.mockResolvedValue(null);
    await patch({ price: '1' }).expect(404);
    expect(productWrite).not.toHaveBeenCalled();
  });
  it.each(['P2025', 'P2003'])(
    'safely rejects %s during an edit write',
    async (code) => {
      productWrite.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('secret', {
          code,
          clientVersion: 'test',
        }),
      );
      const response = await patch({ price: '1' }).expect(404);
      expect(JSON.stringify(response.body)).not.toContain('secret');
    },
  );
  it.each(['OWNER', 'ADMIN', 'MANAGER'])(
    'allows %s with exact prices and safe defaults',
    async (value) => {
      role = value;
      const res = await post({ name: ' Latte ', price: '12.50' }).expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.product).toMatchObject({
        ...product,
        price: '12.50',
        createdAt: product.createdAt.toISOString(),
      });
      const query = shopWrite.mock.calls[0][0];
      expect(query.where).toMatchObject({
        id: shopId,
        isActive: true,
        members: {
          some: {
            userId,
            role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
            user: { isActive: true },
          },
        },
      });
      expect(query.data.products.create).toEqual({
        name: 'Latte',
        slug: 'latte',
        price: '12.50',
        categoryId: undefined,
        description: null,
        imageUrl: null,
        status: 'AVAILABLE',
        isFeatured: false,
        sortOrder: 0,
      });
      expect(query.select.products.where).toEqual({ shopId, slug: 'latte' });
    },
  );
  it('creates all fields through a category write scoped to the actor and shop', async () => {
    await post({
      name: 'Latte',
      price: '12.50',
      categoryId,
      description: ' Milky ',
      status: 'SOLD_OUT',
      imageUrl: 'https://example.com/latte.jpg',
      isFeatured: true,
      sortOrder: 7,
    }).expect(201);
    expect(shopWrite).not.toHaveBeenCalled();
    const query = categoryWrite.mock.calls[0][0];
    expect(query.where).toMatchObject({
      id: categoryId,
      shopId,
      shop: { id: shopId, members: { some: { userId } } },
    });
    expect(query.data.products.create).toMatchObject({
      description: 'Milky',
      status: 'SOLD_OUT',
      isFeatured: true,
      sortOrder: 7,
      imageUrl: 'https://example.com/latte.jpg',
      shop: { connect: { id: shopId } },
    });
  });
  it.each(['CASHIER', 'KITCHEN'])(
    'denies %s before business queries',
    async (value) => {
      role = value;
      await post().expect(403);
      await get().expect(403);
      expect(shopWrite).not.toHaveBeenCalled();
      expect(shopRead).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { name: '', price: '1' },
    { name: null, price: '1' },
    { name: 'x'.repeat(121), price: '1' },
    { name: 'La\u0000tte', price: '1' },
    ...[
      undefined,
      null,
      10,
      '-1',
      '+1',
      '1e2',
      'NaN',
      '1.001',
      '100000000',
      '01',
      '.50',
    ].map((price) => ({ name: 'Latte', price })),
    ...[
      { categoryId: other },
      { categoryId: null },
      { description: null },
      { status: 'INVALID' },
      { status: null },
      { isFeatured: 'true' },
      { isFeatured: null },
      { sortOrder: -1 },
      { sortOrder: 1.5 },
      { sortOrder: '1' },
      { sortOrder: 2147483648 },
      { imageUrl: 'http://example.com/a' },
      { imageUrl: 'https://user:pass@example.com/a' },
      { imageUrl: 'javascript:alert(1)' },
      { imageUrl: null },
      { shopId: other },
      { slug: 'custom' },
    ]
      .filter((value) => !('categoryId' in value && value.categoryId === other))
      .map((fields) => ({ name: 'Latte', price: '1', ...fields })),
  ])('rejects invalid or injected fields (%j)', async (body) => {
    await post(body).expect(400);
    expect(shopWrite).not.toHaveBeenCalled();
    expect(categoryWrite).not.toHaveBeenCalled();
  });
  it('rejects a foreign category even when the actor belongs to both shops', async () => {
    await post({ name: 'Latte', price: '1', categoryId }, other).expect(404);
    expect(categoryRead.mock.calls[0][0].where).toMatchObject({
      id: categoryId,
      shopId: other,
    });
    expect(shopWrite).not.toHaveBeenCalled();
    expect(categoryWrite).not.toHaveBeenCalled();
  });
  it('rejects malformed and nonexistent category references without creating a product', async () => {
    await post({ name: 'Latte', price: '1', categoryId: 'bad-id' }).expect(400);
    expect(categoryRead).not.toHaveBeenCalled();
    await post({ name: 'Latte', price: '1', categoryId: other }).expect(404);
    expect(shopWrite).not.toHaveBeenCalled();
    expect(categoryWrite).not.toHaveBeenCalled();
  });
  it('rejects inaccessible shop references despite forged shop hints', async () => {
    membership.mockResolvedValue(null);
    await post({ name: 'Latte', price: '1' }, other)
      .query({ shopId })
      .set('X-Shop-Id', shopId)
      .expect(404);
    expect(shopWrite).not.toHaveBeenCalled();
    expect(categoryWrite).not.toHaveBeenCalled();
  });
  it('rejects guests, malformed tenants and removed membership', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/products`)
      .send({ name: 'Latte', price: '1' })
      .expect(401);
    await post(undefined, 'bad-id').expect(400);
    membership.mockResolvedValue(null);
    await post().expect(404);
    expect(shopWrite).not.toHaveBeenCalled();
  });
  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 404],
  ])('handles %s without leaking database details', async (code, status) => {
    categoryWrite.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('secret database detail', {
        code,
        clientVersion: 'test',
      }),
    );
    const res = await post({ name: 'Latte', price: '1', categoryId }).expect(
      status as number,
    );
    expect(JSON.stringify(res.body)).not.toContain('secret');
    if (status === 409) expect(res.body.fieldErrors.name).toBeDefined();
  });
  it('lists with deterministic order and repeats live shop access checks', async () => {
    const res = await get().expect(200);
    expect(res.body.products[0].price).toBe('12.50');
    const query = shopRead.mock.calls[0][0];
    expect(query.where.id).toBe(shopId);
    expect(query.select.products.where).toEqual({ shopId });
    expect(query.select.products.orderBy).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    shopRead.mockResolvedValue(null);
    await get().expect(403);
  });
});
