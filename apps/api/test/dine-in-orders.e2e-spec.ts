import { Test } from '@nestjs/testing';
import { ADD_ON_LIMITS } from '@paserve/contracts';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureRequestBody } from '../src/common/http/request-body.js';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { requestValidationPipe } from '../src/common/pipes/request-validation.pipe.js';
import { TableContextService } from '../src/modules/tables/table-context.service.js';
import { ConfigService } from '@nestjs/config';
const contexts = new TableContextService(new ConfigService());

const id = '10000000-0000-4000-8000-000000000001';
const payload = () => ({
  requestId: id,
  tableCode: 'T12',
  tableToken: contexts.issue('cafe', 'T12'),
  items: [
    {
      productId: id,
      quantity: 2,
      variantIds: [],
      addOnIds: [],
      notes: ' Less ice ',
    },
  ],
});
describe('dine-in order submission', () => {
  let app: INestApplication<App>;
  const raw = vi.fn();
  const product = vi.fn();
  const submittedProducts = vi.fn();
  const saved = vi.fn();
  const create = vi.fn();
  const tx = {
    $queryRaw: raw,
    shop: { findFirst: vi.fn() },
    product: { findFirst: product, findMany: submittedProducts },
    order: { findUnique: saved, create },
  };
  const transaction = vi.fn((callback: (db: typeof tx) => unknown) =>
    callback(tx),
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $transaction: transaction,
        shop: tx.shop,
        product: tx.product,
      })
      .compile();
    const expressApp = module.createNestApplication<NestExpressApplication>();
    configureRequestBody(expressApp);
    app = expressApp;
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(requestValidationPipe());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    raw
      .mockReset()
      .mockResolvedValueOnce([
        { id: 'shop-a', isActive: true, acceptingOrders: true },
      ])
      .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
    saved.mockReset().mockResolvedValue(null);
    submittedProducts
      .mockReset()
      .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((productId) => ({
          id: productId,
          status: 'AVAILABLE',
          isArchived: false,
        })),
      );
    tx.shop.findFirst.mockResolvedValue({
      id: 'shop-a',
      isActive: true,
      acceptingOrders: true,
    });
    product.mockReset().mockResolvedValue({
      id,
      name: 'Coffee',
      price: new Prisma.Decimal('10.01'),
      status: 'AVAILABLE',
      optionGroups: [],
      variants: [],
      addOns: [],
    });
    create.mockReset().mockImplementation(({ data }) => ({
      ...data,
      id: 'order-a',
      status: 'PENDING',
      createdAt: new Date('2026-10-12T00:00:00Z'),
    }));
  });
  const post = (body: unknown = payload()) =>
    request(app.getHttpServer()).post('/api/v1/menu/cafe/orders').send(body);
  it('accepts a valid configured 100-line order larger than the default JSON limit', async () => {
    const optionId = (n: number) =>
      `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const variants = Array.from({ length: 50 }, (_, n) => ({
      id: optionId(n + 1),
      optionGroupId: optionId(n + 101),
      name: `Choice ${n}`,
      isDefault: false,
      priceAdjustment: new Prisma.Decimal(0),
    }));
    const addOns = Array.from({ length: 50 }, (_, n) => ({
      addOn: {
        id: optionId(n + 201),
        name: `Extra ${n}`,
        priceAdjustment: new Prisma.Decimal(0),
      },
    }));
    product.mockResolvedValue({
      ...(await product()),
      variants,
      addOns,
      optionGroups: variants.map((variant) => ({
        id: variant.optionGroupId,
        name: 'Choice',
        isRequired: true,
      })),
    });
    const body = {
      ...payload(),
      items: Array.from({ length: 100 }, () => ({
        productId: id,
        quantity: 1,
        variantIds: variants.map((variant) => variant.id),
        addOnIds: addOns.map(({ addOn }) => addOn.id),
        notes: 'x'.repeat(300),
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(100 * 1024);
    const result = await post(body).expect(201);
    expect(result.body.order.items).toHaveLength(100);
    expect(result.body.order.totalPrice).toBe('1001.00');
  });
  it('rejects JSON beyond the transport limit without creating an order', async () => {
    await post({ ...payload(), padding: 'x'.repeat(1024 * 1024) }).expect(413);
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('inherits DINE_IN and binds a server-resolved shop/table with authoritative prices', async () => {
    const result = await post().expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.order).toMatchObject({
      mode: 'DINE_IN',
      status: 'PENDING',
      totalPrice: '20.02',
      table: { shopSlug: 'cafe', code: 'T12', number: 'Patio 4' },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      shopId: 'shop-a',
      tableId: 'table-a',
      mode: 'DINE_IN',
    });
    expect(result.body.order.items[0].notes).toBe('Less ice');
    expect(product.mock.calls[0][0].where).toMatchObject({
      shopId: 'shop-a',
      shop: { isActive: true },
    });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
      timeout: 30_000,
    });
  });
  it('accepts explicit dine-in mode', async () => {
    await post({ ...payload(), mode: 'DINE_IN' }).expect(201);
  });
  it.each([
    { ...payload(), mode: 'TAKEAWAY' },
    { ...payload(), mode: null },
    { ...payload(), tableCode: undefined },
    { ...payload(), tableToken: undefined },
    { ...payload(), tableToken: 'invalid' },
    { ...payload(), tableCode: id },
    { ...payload(), tableId: id },
    { ...payload(), shopId: id },
    { ...payload(), requestId: 'bad' },
    { ...payload(), items: [] },
    { ...payload(), items: [{ ...payload().items[0], quantity: 0 }] },
    { ...payload(), items: [{ ...payload().items[0], unitPrice: '0.01' }] },
    { ...payload(), items: [{ ...payload().items[0], productId: 'bad' }] },
  ])('rejects invalid input without a database write: %j', async (body) => {
    await post(body).expect(400);
    expect(create).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects inactive or foreign tables before pricing or insertion', async () => {
    raw
      .mockReset()
      .mockResolvedValueOnce([
        { id: 'shop-a', isActive: true, acceptingOrders: true },
      ])
      .mockResolvedValueOnce([]);
    await post().expect(404);
    expect(product).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(raw.mock.calls[1][1]).toBe('shop-a');
    expect(raw.mock.calls[1][2]).toBe('T12');
    expect(raw.mock.calls[1][0].join('?')).toContain(
      'AND "isActive" = true FOR SHARE',
    );
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'rejects a nonexistent route shop before pricing or insertion for %s',
    async (mode) => {
      raw.mockReset().mockResolvedValue([]);
      await post(mode === 'DINE_IN' ? payload() : takeout()).expect(404);
      expect(saved).not.toHaveBeenCalled();
      expect(product).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'rejects an inactive route shop before table resolution or pricing for %s',
    async (mode) => {
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', isActive: false, acceptingOrders: true },
        ]);
      await post(mode === 'DINE_IN' ? payload() : takeout()).expect(404);
      expect(raw).toHaveBeenCalledTimes(1);
      expect(product).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'blocks new %s orders at a paused shop and resumes when intake reopens',
    async (mode) => {
      const body = mode === 'DINE_IN' ? payload() : takeout();
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', isActive: true, acceptingOrders: false },
        ]);
      const result = await post(body).expect(409);
      expect(result.body.code).toBe('SHOP_NOT_ACCEPTING_ORDERS');
      expect(raw).toHaveBeenCalledTimes(1);
      expect(product).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      raw
        .mockReset()
        .mockResolvedValueOnce([
          { id: 'shop-a', isActive: true, acceptingOrders: true },
        ])
        .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
      await post(body).expect(201);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'confirms matching %s retries after intake pauses and rejects changed payloads',
    async (mode) => {
      const body = mode === 'DINE_IN' ? payload() : takeout();
      await post(body).expect(201);
      saved.mockResolvedValue({
        ...create.mock.calls[0][0].data,
        id: 'order-a',
        createdAt: new Date(),
      });
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', isActive: true, acceptingOrders: false },
        ]);
      const replay = await post(body).expect(201);
      expect(replay.body.order.id).toBe('order-a');
      await post({
        ...body,
        items: [{ ...body.items[0], quantity: 3 }],
      }).expect(409);
      expect(create).toHaveBeenCalledTimes(1);
      expect(raw).toHaveBeenCalledTimes(2);
    },
  );
  it('resolves the route slug with a row lock and ignores header/query shop hints', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/menu/cafe/orders?shopId=foreign-shop&shopSlug=other')
      .set('X-Shop-Id', 'foreign-shop')
      .set('X-Shop-Slug', 'other')
      .send(takeout())
      .expect(201);
    expect(raw.mock.calls[0][1]).toBe('cafe');
    expect(raw.mock.calls[0][0].join('?')).toContain(
      '"acceptingOrders" FROM "shops" WHERE "slug" = ? FOR SHARE',
    );
    expect(saved).toHaveBeenCalledWith({
      where: { shopId_requestId: { shopId: 'shop-a', requestId: id } },
    });
    expect(create.mock.calls[0][0].data.shopId).toBe('shop-a');
  });
  it.each(['BadSlug', 'cafe_', 'a'.repeat(101)])(
    'rejects malformed route shop %s before database access',
    async (slug) => {
      await request(app.getHttpServer())
        .post(`/api/v1/menu/${slug}/orders`)
        .send(takeout())
        .expect(404);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    { shopSlug: 'other' },
    { acceptingOrders: true },
    { isActive: true },
  ])('rejects client shop overrides: %j', async (override) => {
    await post({ ...takeout(), ...override }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'resolves every distinct product under the route shop for %s and preserves separate lines',
    async (mode) => {
      const secondId = '10000000-0000-4000-8000-000000000099';
      submittedProducts.mockResolvedValue(
        [secondId, id].map((productId) => ({
          id: productId,
          status: 'AVAILABLE',
          isArchived: false,
        })),
      );
      product.mockImplementation(
        async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          name: 'Coffee',
          price: new Prisma.Decimal('10.01'),
          status: 'AVAILABLE',
          optionGroups: [],
          variants: [],
          addOns: [],
        }),
      );
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const lines = [
        body.items[0],
        { ...body.items[0], productId: secondId },
        { ...body.items[0], quantity: 1, notes: 'No ice' },
      ];
      const result = await post({ ...body, items: lines }).expect(201);
      expect(submittedProducts).toHaveBeenCalledExactlyOnceWith({
        where: { shopId: 'shop-a', id: { in: [id, secondId] } },
        select: { id: true, status: true, isArchived: true },
      });
      expect(
        result.body.order.items.map(
          (item: { productId: string }) => item.productId,
        ),
      ).toEqual([id, secondId, id]);
      expect(
        result.body.order.items.map(
          (item: { quantity: number }) => item.quantity,
        ),
      ).toEqual([2, 2, 1]);
      expect(result.body.order.items[2].notes).toBe('No ice');
      expect(result.body.order.totalPrice).toBe('50.05');
    },
  );
  describe.each(['DINE_IN', 'TAKEOUT'] as const)(
    '%s product identity rejection',
    (mode) => {
      const unknownId = '10000000-0000-4000-8000-000000000099';
      it('rejects unresolved products and mixed batches before pricing', async () => {
        const body = mode === 'DINE_IN' ? payload() : takeout();
        submittedProducts.mockImplementation(
          async ({
            where,
          }: {
            where: { shopId: string; id: { in: string[] } };
          }) => {
            expect(where.shopId).toBe('shop-a');
            return where.id.in
              .filter((productId) => productId === id)
              .map((productId) => ({ id: productId }));
          },
        );
        for (const lines of [
          [{ ...body.items[0], productId: unknownId }],
          [body.items[0], { ...body.items[0], productId: unknownId }],
          [{ ...body.items[0], productId: unknownId }, body.items[0]],
        ]) {
          // Reset route resolution for each new attempt, keeping the scoped product result.
          raw
            .mockReset()
            .mockResolvedValueOnce([
              { id: 'shop-a', isActive: true, acceptingOrders: true },
            ])
            .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
          const result = await post({ ...body, items: lines }).expect(404);
          expect(result.body.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(result.body.message).toBe(
            'This product is unavailable. Refresh the menu and update your cart before ordering again.',
          );
        }
        expect(product).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });
      it('confirms an existing order without fetching products removed from the menu', async () => {
        const body = mode === 'DINE_IN' ? payload() : takeout();
        await post(body).expect(201);
        saved.mockResolvedValue({
          ...create.mock.calls[0][0].data,
          id: 'order-a',
          createdAt: new Date(),
        });
        submittedProducts.mockClear().mockResolvedValue([]);
        product.mockClear().mockResolvedValue(null);
        raw
          .mockReset()
          .mockResolvedValue([
            { id: 'shop-a', isActive: true, acceptingOrders: true },
          ]);
        const result = await post(body).expect(201);
        expect(result.body.order.id).toBe('order-a');
        expect(submittedProducts).not.toHaveBeenCalled();
        expect(product).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
      });
    },
  );
  describe.each(['DINE_IN', 'TAKEOUT'] as const)(
    '%s latest product availability',
    (mode) => {
      it.each([
        { status: 'SOLD_OUT', isArchived: false },
        { status: 'HIDDEN', isArchived: false },
        { status: 'AVAILABLE', isArchived: true },
      ])(
        'rejects a previously previewed product that changed to %j and accepts it after restoration',
        async (state) => {
          const body = mode === 'DINE_IN' ? payload() : takeout();
          const { productId, ...selection } = body.items[0];
          await request(app.getHttpServer())
            .post(`/api/v1/menu/cafe/products/${productId}/quote`)
            .send(selection)
            .expect(201);
          product.mockClear();
          submittedProducts.mockResolvedValue([{ id, ...state }]);
          const rejected = await post(body).expect(404);
          expect(rejected.body.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(rejected.body.message).toBe(
            'This product is unavailable. Refresh the menu and update your cart before ordering again.',
          );
          expect(product).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
          submittedProducts.mockResolvedValue([
            { id, status: 'AVAILABLE', isArchived: false },
          ]);
          raw
            .mockReset()
            .mockResolvedValueOnce([
              { id: 'shop-a', isActive: true, acceptingOrders: true },
            ])
            .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
          await post(body).expect(201);
          expect(create).toHaveBeenCalledTimes(1);
        },
      );
      it.each([0, 1])(
        'rejects a mixed cart with an unavailable product at position %s before pricing',
        async (position) => {
          const secondId = '10000000-0000-4000-8000-000000000099';
          const body = mode === 'DINE_IN' ? payload() : takeout();
          const lines = [
            body.items[0],
            { ...body.items[0], productId: secondId },
          ];
          if (position === 0) lines.reverse();
          submittedProducts.mockResolvedValue([
            { id, status: 'AVAILABLE', isArchived: false },
            { id: secondId, status: 'SOLD_OUT', isArchived: false },
          ]);
          await post({ ...body, items: lines }).expect(404);
          expect(product).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        },
      );
    },
  );
  it.each([
    { status: 'AVAILABLE' },
    { isOrderable: true },
    { isAvailable: true },
    { isArchived: false },
  ])('rejects frontend availability fields on a line: %j', async (state) => {
    await post({
      ...payload(),
      items: [{ ...payload().items[0], ...state }],
    }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects sold-out or missing products without saving an order', async () => {
    product.mockResolvedValue(null);
    await post().expect(404);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a product that became sold out after it was added to the cart', async () => {
    const available = await product();
    product.mockResolvedValue({ ...available, status: 'SOLD_OUT' });
    await post().expect(404);
    expect(create).not.toHaveBeenCalled();
  });
  it('does not insert a partial order when a later line is unavailable', async () => {
    const available = await product();
    product
      .mockReset()
      .mockResolvedValueOnce(available)
      .mockResolvedValueOnce(null);
    await post({
      ...payload(),
      items: [payload().items[0], payload().items[0]],
    }).expect(404);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects unavailable choices without saving an order', async () => {
    await post({
      ...payload(),
      items: [{ ...payload().items[0], variantIds: [id] }],
    }).expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('returns the existing order on a retry and rejects request ID reuse with different selections', async () => {
    await post().expect(201);
    const original = {
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      status: 'PENDING',
      createdAt: new Date(),
    };
    saved.mockResolvedValue(original);
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', isActive: true, acceptingOrders: true },
      ]);
    const replay = await post().expect(201);
    expect(replay.body.order.id).toBe('order-a');
    expect(create).toHaveBeenCalledTimes(1);
    await post({
      ...payload(),
      items: [{ ...payload().items[0], quantity: 3 }],
    }).expect(409);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('rejects editing a valid table code while keeping the scanned-table signature', async () => {
    await post({ ...payload(), tableCode: 'T13' }).expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects using another shop route with the scanned context', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/menu/other/orders')
      .send(payload())
      .expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects modifying signed claims even if the format is valid', async () => {
    const token = payload().tableToken;
    const [claims, signature] = token.split('.');
    const changed = {
      ...JSON.parse(Buffer.from(claims, 'base64url').toString()),
      code: 'T13',
    };
    await post({
      ...payload(),
      tableCode: 'T13',
      tableToken: `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`,
    }).expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  const takeout = () => ({
    requestId: id,
    mode: 'TAKEOUT',
    items: payload().items,
  });
  it('creates tableless pickup with authoritative pricing and no table lookup', async () => {
    const result = await post(takeout()).expect(201);
    expect(result.body.order).toMatchObject({
      mode: 'TAKEOUT',
      table: null,
      status: 'PENDING',
      totalPrice: '20.02',
    });
    expect(raw).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      mode: 'TAKEOUT',
      shopId: 'shop-a',
      tableId: null,
      tableCode: null,
      tableNumber: null,
    });
    expect(product.mock.calls[0][0].where.shopId).toBe('shop-a');
  });
  it.each([
    { ...takeout(), tableCode: 'T12' },
    { ...takeout(), tableToken: payload().tableToken },
    { ...takeout(), tableCode: null },
    { ...takeout(), tableToken: null },
    { ...takeout(), tableId: id },
    { ...takeout(), shopId: id },
    { ...takeout(), mode: 'PICKUP' },
    { ...takeout(), mode: undefined },
    { ...takeout(), items: [] },
    { ...takeout(), items: [{ ...payload().items[0], totalPrice: '0.01' }] },
  ])('rejects invalid or mixed takeout fields: %j', async (body) => {
    await post(body).expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects pickup for an inactive shop', async () => {
    raw.mockReset().mockResolvedValue([]);
    const result = await post(takeout()).expect(404);
    expect(result.body.code).toBe('SHOP_NOT_AVAILABLE');
    expect(product).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects unavailable or other-shop pickup items without creating an order', async () => {
    product.mockResolvedValue(null);
    await post(takeout()).expect(404);
    expect(create).not.toHaveBeenCalled();
  });
  it('replays pickup safely and rejects reuse of the same request ID for dine-in', async () => {
    await post(takeout()).expect(201);
    saved.mockResolvedValue({
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      createdAt: new Date(),
    });
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', isActive: true, acceptingOrders: true },
      ]);
    const replay = await post(takeout()).expect(201);
    expect(replay.body.order.mode).toBe('TAKEOUT');
    await post().expect(409);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('confirms an existing pending order after the shop becomes inactive, while blocking new orders', async () => {
    await post(takeout()).expect(201);
    const original = {
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      createdAt: new Date(),
    };
    saved.mockResolvedValue(original);
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', isActive: false, acceptingOrders: true },
      ]);
    const replay = await post(takeout()).expect(201);
    expect(replay.body.order.status).toBe('PENDING');
    expect(create).toHaveBeenCalledTimes(1);
    saved.mockResolvedValue(null);
    await post({
      ...takeout(),
      requestId: '10000000-0000-4000-8000-000000000009',
    }).expect(404);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('does not misrepresent an unexpected saved status as PENDING', async () => {
    await post(takeout()).expect(201);
    saved.mockResolvedValue({
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      status: 'PLACED',
      createdAt: new Date(),
    });
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', isActive: true, acceptingOrders: true },
      ]);
    await post(takeout()).expect(500);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('confirms an existing dine-in order with an expired authentic context but rejects new creation with that token', async () => {
    const original = payload();
    await post(original).expect(201);
    saved.mockResolvedValue({
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      createdAt: new Date(),
    });
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', isActive: false, acceptingOrders: true },
      ]);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 5 * 60 * 60 * 1000);
    try {
      await post(original).expect(201);
      saved.mockResolvedValue(null);
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', isActive: true, acceptingOrders: true },
        ]);
      await post({
        ...original,
        requestId: '10000000-0000-4000-8000-000000000009',
      }).expect(403);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
  const variantId = '10000000-0000-4000-8000-000000000002';
  const groupId = '10000000-0000-4000-8000-000000000003';
  const addOnId = '10000000-0000-4000-8000-000000000004';
  const anotherId = '10000000-0000-4000-8000-000000000005';
  const configuredProduct = (
    base = '10.01',
    variant = '5.10',
    addOn = '2.20',
  ) => ({
    id,
    name: 'Coffee',
    price: new Prisma.Decimal(base),
    status: 'AVAILABLE',
    optionGroups: [{ id: groupId, name: 'Size', isRequired: true }],
    variants: [
      {
        id: variantId,
        optionGroupId: groupId,
        name: 'Large',
        isDefault: false,
        priceAdjustment: new Prisma.Decimal(variant),
      },
    ],
    addOns: [
      {
        addOn: {
          id: addOnId,
          name: 'Oat milk',
          priceAdjustment: new Prisma.Decimal(addOn),
        },
      },
    ],
  });
  const configuredLine = () => ({
    ...payload().items[0],
    variantIds: [variantId],
    addOnIds: [addOnId],
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'recalculates current base/option prices after an earlier preview for %s',
    async (mode) => {
      product.mockResolvedValue(configuredProduct());
      const { productId, ...selection } = configuredLine();
      const preview = await request(app.getHttpServer())
        .post(`/api/v1/menu/cafe/products/${productId}/quote`)
        .send(selection)
        .expect(201);
      expect(preview.body.totalPrice).toBe('34.62');
      product.mockResolvedValue(configuredProduct('20.03', '6.07', '2.15'));
      const body =
        mode === 'DINE_IN'
          ? { ...payload(), mode, items: [configuredLine()] }
          : { ...takeout(), items: [configuredLine()] };
      const result = await post(body).expect(201);
      expect(result.body.order.totalPrice).toBe('56.50');
      expect(result.body.order.items[0]).toMatchObject({
        productId: id,
        quantity: 2,
        notes: 'Less ice',
        basePrice: '20.03',
        unitPrice: '28.25',
        totalPrice: '56.50',
        variants: [{ id: variantId, priceAdjustment: '6.07' }],
        addOns: [{ id: addOnId, priceAdjustment: '2.15' }],
      });
      expect(create.mock.calls[0][0].data.totalPrice.toFixed(2)).toBe('56.50');
      expect(create.mock.calls[0][0].data.items[0]).toEqual(
        result.body.order.items[0],
      );
    },
  );
  describe.each(['DINE_IN', 'TAKEOUT'] as const)(
    '%s variant validation',
    (mode) => {
      const orderBody = () => ({
        ...(mode === 'DINE_IN' ? payload() : takeout()),
        items: [configuredLine()],
      });
      it.each(['variant', 'group'])(
        'rejects a selected %s that became unavailable after preview',
        async (kind) => {
          product.mockResolvedValue(configuredProduct());
          const { productId, ...selection } = configuredLine();
          await request(app.getHttpServer())
            .post(`/api/v1/menu/cafe/products/${productId}/quote`)
            .send(selection)
            .expect(201);
          product.mockResolvedValue({
            ...configuredProduct(),
            variants: [],
            ...(kind === 'group' ? { optionGroups: [] } : {}),
          });
          const result = await post(orderBody()).expect(400);
          expect(result.body.code).toBe('PRODUCT_SELECTION_INVALID');
          expect(result.body.message).toBe(
            'Choose available options for this product and complete all required choices.',
          );
          expect(create).not.toHaveBeenCalled();
          expect(
            product.mock.calls.at(-1)![0].select.variants.where,
          ).toMatchObject({
            shopId: 'shop-a',
            productId: id,
            isAvailable: true,
          });
        },
      );
      it.each(['same group', 'ungrouped', 'missing group'])(
        'rejects conflicting or invalid group choices: %s',
        async (kind) => {
          const data = configuredProduct();
          const first = data.variants[0];
          product.mockResolvedValue({
            ...data,
            optionGroups: kind === 'same group' ? data.optionGroups : [],
            variants:
              kind === 'ungrouped'
                ? [
                    { ...first, optionGroupId: null },
                    { ...first, id: anotherId, optionGroupId: null },
                  ]
                : kind === 'missing group'
                  ? [first]
                  : [first, { ...first, id: anotherId }],
          });
          const result = await post({
            ...orderBody(),
            items: [
              {
                ...configuredLine(),
                variantIds:
                  kind === 'missing group'
                    ? [variantId]
                    : [variantId, anotherId],
              },
            ],
          }).expect(400);
          expect(result.body.code).toBe('PRODUCT_SELECTION_INVALID');
          expect(create).not.toHaveBeenCalled();
        },
      );
      it('accepts one current choice per required group with server prices', async () => {
        const data = configuredProduct();
        product.mockResolvedValue({
          ...data,
          optionGroups: [
            ...data.optionGroups,
            { id: anotherId, name: 'Temperature', isRequired: true },
          ],
          variants: [
            ...data.variants,
            {
              ...data.variants[0],
              id: anotherId,
              optionGroupId: anotherId,
              name: 'Iced',
              priceAdjustment: new Prisma.Decimal('1.00'),
            },
          ],
        });
        const result = await post({
          ...orderBody(),
          items: [{ ...configuredLine(), variantIds: [variantId, anotherId] }],
        }).expect(201);
        expect(
          result.body.order.items[0].variants.map(
            (variant: { name: string }) => variant.name,
          ),
        ).toEqual(['Large', 'Iced']);
        expect(result.body.order.totalPrice).toBe('36.62');
      });
      it('rejects a missing required choice even when the group has no available variants', async () => {
        product.mockResolvedValue({ ...configuredProduct(), variants: [] });
        const result = await post({
          ...orderBody(),
          items: [{ ...configuredLine(), variantIds: [] }],
        }).expect(400);
        expect(result.body.code).toBe('PRODUCT_SELECTION_INVALID');
        expect(create).not.toHaveBeenCalled();
      });
      it('rejects duplicate selected variant IDs before database access', async () => {
        await post({
          ...orderBody(),
          items: [{ ...configuredLine(), variantIds: [variantId, variantId] }],
        }).expect(400);
        expect(transaction).not.toHaveBeenCalled();
      });
    },
  );
  describe.each(['DINE_IN', 'TAKEOUT'] as const)(
    '%s add-on validation',
    (mode) => {
      const orderBody = () => ({
        ...(mode === 'DINE_IN' ? payload() : takeout()),
        items: [configuredLine()],
      });
      it('rejects stale add-on eligibility after a successful preview', async () => {
        product.mockResolvedValue(configuredProduct());
        const { productId, ...selection } = configuredLine();
        await request(app.getHttpServer())
          .post(`/api/v1/menu/cafe/products/${productId}/quote`)
          .send(selection)
          .expect(201);
        product.mockResolvedValue({ ...configuredProduct(), addOns: [] });
        const result = await post(orderBody()).expect(400);
        expect(result.body.code).toBe('PRODUCT_SELECTION_INVALID');
        expect(result.body.message).toBe(
          'Choose available options for this product and complete all required choices.',
        );
        expect(create).not.toHaveBeenCalled();
        expect(product.mock.calls.at(-1)![0].select.addOns.where).toEqual({
          shopId: 'shop-a',
          productId: id,
          addOn: { shopId: 'shop-a', isAvailable: true },
        });
      });
      it.each([0, 1])(
        'rejects mixed batches containing an ineligible modifier at position %s',
        async (position) => {
          product.mockResolvedValue(configuredProduct());
          const lines = [
            configuredLine(),
            { ...configuredLine(), addOnIds: [anotherId] },
          ];
          if (position === 0) lines.reverse();
          const result = await post({ ...orderBody(), items: lines }).expect(
            400,
          );
          expect(result.body.code).toBe('PRODUCT_SELECTION_INVALID');
          expect(create).not.toHaveBeenCalled();
        },
      );
      it.each([0, ADD_ON_LIMITS.selectionMax])(
        'accepts %s allowed modifiers including free choices',
        async (count) => {
          const choices = Array.from({ length: count }, (_, index) => ({
            addOn: {
              id: `20000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
              name: `Modifier ${index}`,
              priceAdjustment: new Prisma.Decimal(
                index === 0 ? '0.00' : '1.00',
              ),
            },
          }));
          product.mockResolvedValue({
            ...configuredProduct(),
            addOns: choices,
          });
          const result = await post({
            ...orderBody(),
            items: [
              {
                ...configuredLine(),
                addOnIds: choices.map(({ addOn }) => addOn.id),
              },
            ],
          }).expect(201);
          expect(result.body.order.items[0].addOns).toHaveLength(count);
          expect(result.body.order.totalPrice).toBe(count ? '128.22' : '30.22');
          if (count)
            expect(result.body.order.items[0].addOns[0].priceAdjustment).toBe(
              '0.00',
            );
        },
      );
      it.each(['over limit', 'duplicates', 'malformed'])(
        'rejects %s modifiers before database access',
        async (kind) => {
          const ids =
            kind === 'over limit'
              ? Array.from(
                  { length: ADD_ON_LIMITS.selectionMax + 1 },
                  (_, index) =>
                    `20000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
                )
              : kind === 'duplicates'
                ? [addOnId, addOnId]
                : ['bad'];
          const result = await post({
            ...orderBody(),
            items: [{ ...configuredLine(), addOnIds: ids }],
          }).expect(400);
          expect(result.body.code).toBe('VALIDATION_ERROR');
          expect(transaction).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        },
      );
    },
  );
  const forgedFields = [
    { scope: 'order', field: 'totalPrice', value: '0.01' },
    { scope: 'order', field: 'subtotal', value: '0.01' },
    { scope: 'order', field: 'currency', value: 'USD' },
    { scope: 'line', field: 'unitPrice', value: '0.01' },
    { scope: 'line', field: 'totalPrice', value: '0.01' },
    { scope: 'line', field: 'basePrice', value: '0.01' },
    {
      scope: 'line',
      field: 'variants',
      value: [{ id: variantId, priceAdjustment: '0.00' }],
    },
    {
      scope: 'line',
      field: 'addOns',
      value: [{ id: addOnId, priceAdjustment: '0.00' }],
    },
  ];
  it.each(
    forgedFields.flatMap((fields) =>
      ['DINE_IN', 'TAKEOUT'].map((mode) => ({ ...fields, mode })),
    ),
  )(
    'rejects client price/display fields before any database access: $mode $scope.$field',
    async ({ scope, field, value, mode }) => {
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const forged =
        scope === 'order'
          ? { ...body, [field]: value }
          : { ...body, items: [{ ...body.items[0], [field]: value }] };
      const result = await post(forged).expect(400);
      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(transaction).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...configuredLine(), variantIds: [] },
    { ...configuredLine(), variantIds: [anotherId] },
    { ...configuredLine(), addOnIds: [anotherId] },
    { ...configuredLine(), variantIds: [variantId, variantId] },
    { ...configuredLine(), addOnIds: [addOnId, addOnId] },
    { ...configuredLine(), quantity: 1.5 },
    { ...configuredLine(), quantity: '2' },
    { ...configuredLine(), quantity: 100 },
    { ...configuredLine(), notes: null },
  ])(
    'rejects invalid identifiers/options/quantity/notes without insertion: %j',
    async (line) => {
      product.mockResolvedValue(configuredProduct());
      await post({ ...takeout(), items: [line] }).expect(400);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('accepts the maximum supported 100 selection-only lines with exact totals', async () => {
    const items = Array.from({ length: 100 }, () => ({
      ...payload().items[0],
      quantity: 99,
    }));
    const result = await post({ ...takeout(), items }).expect(201);
    expect(result.body.order.items).toHaveLength(100);
    expect(result.body.order.totalPrice).toBe('99099.00');
    expect(create).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1].timeout).toBe(30000);
  });
  it('rejects oversized batches before pricing or creating an order', async () => {
    await post({
      ...takeout(),
      items: Array.from({ length: 101 }, () => payload().items[0]),
    }).expect(400);
    expect(product).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
