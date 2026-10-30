import { resetRateLimits } from './rate-limit-test-utils.js';
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
  const requestLookup = vi.fn(async (...args: unknown[]) => {
    const result: unknown = await saved(...args);
    return result ? [result] : [];
  });
  const create = vi.fn();
  const createItems = vi.fn();
  const readItems = vi.fn();
  const tx = {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) =>
      query.join('').includes('lower("requestId")')
        ? requestLookup(query, ...values)
        : raw(query, ...values),
    shop: { findFirst: vi.fn(), update: vi.fn() },
    product: {
      findFirst: product,
      findMany: async (args: {
        where: { id: { in: string[] } };
        select?: { optionGroups?: unknown };
      }) => {
        if (!args.select?.optionGroups) return submittedProducts(args);
        // Reuse per-product pricing fixtures for the new batched projection.
        // Real SQL query-count assertions live in the PostgreSQL fixture.
        const rows = await Promise.all(
          args.where.id.in.map((productId) =>
            product({ ...args, where: { ...args.where, id: productId } }),
          ),
        );
        return rows.filter(Boolean);
      },
    },
    order: { findUnique: saved, create },
    orderItem: { createMany: createItems, findMany: readItems },
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
    resetRateLimits(app);
    vi.clearAllMocks();
    raw
      .mockReset()
      .mockResolvedValueOnce([
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
      ])
      .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
    saved.mockReset().mockResolvedValue(null);
    requestLookup.mockClear();
    let persistedLines: Record<string, unknown>[] = [];
    createItems
      .mockReset()
      .mockImplementation(
        async ({ data }: { data: Record<string, unknown>[] }) => {
          persistedLines = data;
          return { count: data.length };
        },
      );
    readItems
      .mockReset()
      .mockImplementation(
        async ({ where }: { where: { shopId: string; orderId: string } }) =>
          persistedLines.filter(
            (line) =>
              line.shopId === where.shopId && line.orderId === where.orderId,
          ),
      );
    let nextNumber = 0n;
    tx.shop.update
      .mockReset()
      .mockImplementation(async () => ({ lastOrderNumber: ++nextNumber }));
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
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date('2026-10-12T00:00:00Z'),
    }));
  });
  const post = (body: unknown = payload()) =>
    request(app.getHttpServer()).post('/api/v1/menu/cafe/orders').send(body);
  it('normalizes UUID request identity and replays legacy mixed-case keys without another order', async () => {
    const requestId = 'aabbccdd-1111-4111-8111-aabbccddeeff';
    const first = await post({
      ...payload(),
      requestId: requestId.toUpperCase(),
    }).expect(201);
    expect(create.mock.calls[0][0].data.requestId).toBe(requestId);
    saved.mockResolvedValue({
      ...create.mock.results[0].value,
      requestId: requestId.toUpperCase(),
    });
    raw.mockResolvedValueOnce([
      { id: 'shop-a', isActive: true, acceptingOrders: true },
    ]);
    const replay = await post({ ...payload(), requestId }).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.shop.update).toHaveBeenCalledTimes(1);
    expect(requestLookup.mock.calls[1].slice(1)).toEqual(['shop-a', requestId]);
  });
  it.each(['TABLE_SERVICE', 'COUNTER_PICKUP'] as const)(
    'saves %s independently of dine-in mode and table context',
    async (serviceType) => {
      const result = await post({
        ...payload(),
        mode: 'DINE_IN',
        serviceType,
      }).expect(201);
      expect(result.body.order).toMatchObject({
        mode: 'DINE_IN',
        serviceType,
        table: { code: 'T12' },
      });
      expect(create.mock.calls[0][0].data).toMatchObject({
        mode: 'DINE_IN',
        serviceType,
        tableId: 'table-a',
      });
    },
  );
  it('defaults older dine-in requests to table service', async () => {
    const result = await post().expect(201);
    expect(result.body.order.serviceType).toBe('TABLE_SERVICE');
  });
  it.each(['DELIVERY', '', null, 12])(
    'rejects invalid service type %j before a transaction',
    async (serviceType) => {
      await post({ ...payload(), serviceType }).expect(400);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects a dine-in service type on takeout', async () => {
    await post({ ...takeout(), serviceType: 'COUNTER_PICKUP' }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([
    ['TABLE_SERVICE', 'COUNTER_PICKUP'],
    ['COUNTER_PICKUP', 'TABLE_SERVICE'],
  ])(
    'rejects service %s when the shop offers only %s',
    async (serviceType, dineInServiceMode) => {
      raw.mockReset().mockResolvedValueOnce([
        {
          id: 'shop-a',
          isActive: true,
          acceptingOrders: true,
          dineInServiceMode,
        },
      ]);
      const result = await post({ ...payload(), serviceType }).expect(409);
      expect(result.body.code).toBe('SERVICE_TYPE_NOT_AVAILABLE');
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('keeps the original counter pickup choice on replay and rejects changing it under the same request ID', async () => {
    const body = { ...payload(), serviceType: 'COUNTER_PICKUP' };
    await post(body).expect(201);
    saved.mockResolvedValue(create.mock.results[0].value);
    // A later settings change does not prevent recovery of an existing order.
    raw.mockReset().mockResolvedValue([
      {
        id: 'shop-a',
        isActive: true,
        acceptingOrders: true,
        dineInServiceMode: 'TABLE_SERVICE',
      },
    ]);
    const replay = await post(body).expect(201);
    expect(replay.body.order.serviceType).toBe('COUNTER_PICKUP');
    const changed = await post({
      ...body,
      serviceType: 'TABLE_SERVICE',
    }).expect(409);
    expect(changed.body.code).toBe('ORDER_REQUEST_CONFLICT');
    expect(create).toHaveBeenCalledOnce();
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'rejects changed %s prices before any write and returns current line prices',
    async (mode) => {
      const base = payload();
      const body =
        mode === 'TAKEOUT'
          ? { requestId: id, mode, items: base.items }
          : { ...base, mode };
      const result = await post({ ...body, reviewedTotal: '0.01' }).expect(409);
      expect(result.body).toMatchObject({
        code: 'ORDER_PRICE_CHANGED',
        currency: 'PHP',
        totalPrice: '20.02',
        items: [{ productId: id, unitPrice: '10.01', totalPrice: '20.02' }],
      });
      expect(tx.shop.update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(createItems).not.toHaveBeenCalled();
    },
  );
  it('accepts the reviewed amount only as a guard and preserves idempotent recovery after prices change', async () => {
    const body = { ...payload(), reviewedTotal: '20.02' };
    const first = await post(body).expect(201);
    expect(first.body.order.totalPrice).toBe('20.02');
    const stored = create.mock.results[0].value;
    saved.mockResolvedValue(stored);
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
      ]);
    product.mockClear();
    const replay = await post(body).expect(201);
    expect(replay.body.order.totalPrice).toBe('20.02');
    expect(product).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });
  it.each([12, 'NaN', '-1.00', '1e3', '1.00\n', '10000000000.00'])(
    'rejects invalid reviewed amount %j before a transaction',
    async (reviewedTotal) => {
      await post({ ...payload(), reviewedTotal }).expect(400);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('returns nested field errors and blocks injected pricing before opening a transaction', async () => {
    const body = payload();
    const result = await post({
      ...body,
      items: [{ ...body.items[0], quantity: '2', price: 'private-input' }],
    }).expect(400);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        'items.0.quantity': expect.arrayContaining([expect.any(String)]),
        'items.0.price': expect.arrayContaining([expect.any(String)]),
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('private-input');
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('preserves 300 Unicode characters in notes through pricing and persisted snapshots', async () => {
    const body = payload();
    const notes = '\u{1f600}'.repeat(300);
    const result = await post({
      ...body,
      items: [{ ...body.items[0], notes }],
    }).expect(201);
    expect(result.body.order.items[0].notes).toBe(notes);
    expect(createItems.mock.calls[0][0].data[0].notes).toBe(notes);
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'captures shop display details for %s and preserves them across settings edits and retries',
    async (mode) => {
      const originalShop = {
        id: 'shop-a',
        isActive: true,
        acceptingOrders: true,
        name: 'Internal Cafe',
        displayName: 'Receipt Cafe',
        address: '12 Old Street',
        phone: '09171234567',
        contactEmail: 'hello@example.com',
        website: 'https://example.com',
      };
      raw
        .mockReset()
        .mockResolvedValueOnce([originalShop])
        .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const created = await post(body).expect(201);
      const details = {
        name: 'Receipt Cafe',
        address: '12 Old Street',
        phone: '09171234567',
        contactEmail: 'hello@example.com',
        website: 'https://example.com',
      };
      expect(created.body.order.shopDetails).toEqual(details);
      const persisted = create.mock.calls[0][0].data;
      expect(persisted.shopDetailsSnapshot).toEqual(details);
      saved.mockResolvedValue({ ...persisted, id: 'order-a' });
      raw
        .mockReset()
        .mockResolvedValue([
          { ...originalShop, displayName: 'Renamed', address: 'New address' },
        ]);
      const replay = await post(body).expect(201);
      expect(replay.body.order.shopDetails).toEqual(details);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );
  it('uses the shop name when no display name or contact fields are configured', async () => {
    const result = await post(takeout()).expect(201);
    expect(result.body.order.shopDetails).toEqual({
      name: 'Cafe',
      address: null,
      phone: null,
      contactEmail: null,
      website: null,
    });
  });
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'persists each configured cart line separately in the parent transaction for %s',
    async (mode) => {
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const result = await post({
        ...body,
        items: [
          body.items[0],
          { ...body.items[0], quantity: 1, notes: 'Separate cup' },
        ],
      }).expect(201);
      const trackingCookies = result.headers[
        'set-cookie'
      ] as unknown as string[];
      expect(trackingCookies[0]).toContain('paserve_tracking=');
      expect(trackingCookies[0]).toContain('HttpOnly');
      expect(trackingCookies[0]).toContain('SameSite=Strict');
      expect(trackingCookies[0]).toContain(
        'Path=/api/v1/menu/cafe/orders/order-a',
      );
      expect(result.body.order).not.toHaveProperty('trackingToken');
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(createItems).toHaveBeenCalledTimes(1);
      const rows = createItems.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(
        rows.map((row: { lineNumber: number; quantity: number }) => [
          row.lineNumber,
          row.quantity,
        ]),
      ).toEqual([
        [1, 2],
        [2, 1],
      ]);
      expect(rows[0]).toMatchObject({
        shopId: 'shop-a',
        orderId: 'order-a',
        productId: id,
        notes: 'Less ice',
        snapshot: result.body.order.items[0],
      });
      expect(rows[1]).toMatchObject({
        productId: id,
        notes: 'Separate cup',
        snapshot: result.body.order.items[1],
      });
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(
        createItems.mock.invocationCallOrder[0],
      );
      saved.mockResolvedValue({
        ...create.mock.calls[0][0].data,
        id: 'order-a',
      });
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
        ]);
      await post({
        ...body,
        items: [
          body.items[0],
          { ...body.items[0], quantity: 1, notes: 'Separate cup' },
        ],
      }).expect(201);
      expect(createItems).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['write failure', 'incomplete write'])(
    'fails creation when item persistence returns %s',
    async (kind) => {
      if (kind === 'write failure')
        createItems.mockRejectedValue(new Error('Item insert failed'));
      else createItems.mockResolvedValue({ count: 0 });
      await post(takeout()).expect(500);
      expect(createItems).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'creates server-authored parent metadata for %s and preserves it on replay',
    async (mode) => {
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const created = await post(body).expect(201);
      expect(created.body.order).toMatchObject({
        orderNumber: 'ORD-000001',
        paymentStatus: 'UNPAID',
        status: 'PENDING_CONFIRMATION',
      });
      expect(created.body.order.qrToken).toMatch(
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/,
      );
      const data = create.mock.calls[0][0].data;
      expect(data.createdAt).toEqual(data.updatedAt);
      expect(data.qrTokenNonce).toMatch(/^[0-9a-f-]{36}$/);
      expect(data.qrTokenExpiresAt.getTime()).toBeGreaterThan(
        data.createdAt.getTime(),
      );
      expect(data.qrToken).toBeUndefined();
      expect(tx.shop.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'shop-a', isActive: true, acceptingOrders: true },
        data: { lastOrderNumber: { increment: 1 } },
        select: { lastOrderNumber: true },
      });
      saved.mockResolvedValue({
        ...data,
        id: 'order-a',
        createdAt: new Date('2026-10-12T00:00:00Z'),
      });
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
        ]);
      const replay = await post(body).expect(201);
      expect(replay.body.order).toEqual(created.body.order);
      expect(create).toHaveBeenCalledTimes(1);
      expect(tx.shop.update).toHaveBeenCalledTimes(1);
    },
  );
  it('allocates distinct numbers and tokens for fresh orders', async () => {
    const first = await post(takeout()).expect(201);
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
      ]);
    const second = await post({
      ...takeout(),
      requestId: '10000000-0000-4000-8000-000000000099',
    }).expect(201);
    expect(second.body.order.orderNumber).toBe('ORD-000002');
    expect(second.body.order.qrToken).not.toBe(first.body.order.qrToken);
  });
  it.each([
    { orderNumber: 'ORD-000001' },
    { qrToken: 'forged' },
    { paymentStatus: 'PAID' },
    { status: 'ACCEPTED' },
    { createdAt: '2026-01-01' },
    { updatedAt: '2026-01-01' },
  ])('rejects client parent metadata %j', async (fields) => {
    await post({ ...takeout(), ...fields }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.shop.update).not.toHaveBeenCalled();
  });
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
      status: 'PENDING_CONFIRMATION',
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
    { ...payload(), items: [[]] },
    { ...payload(), items: [[payload().items[0]]] },
    { ...payload(), items: [null] },
    { ...payload(), items: [1] },
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
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
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
      raw.mockReset().mockResolvedValue([
        {
          id: 'shop-a',
          name: 'Cafe',
          isActive: false,
          acceptingOrders: true,
        },
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
      raw.mockReset().mockResolvedValue([
        {
          id: 'shop-a',
          name: 'Cafe',
          isActive: true,
          acceptingOrders: false,
        },
      ]);
      const result = await post(body).expect(409);
      expect(result.body.code).toBe('SHOP_NOT_ACCEPTING_ORDERS');
      expect(raw).toHaveBeenCalledTimes(1);
      expect(product).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      raw
        .mockReset()
        .mockResolvedValueOnce([
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
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
      raw.mockReset().mockResolvedValue([
        {
          id: 'shop-a',
          name: 'Cafe',
          isActive: true,
          acceptingOrders: false,
        },
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
      '"website" FROM "shops" WHERE "slug" = ? FOR UPDATE',
    );
    expect(requestLookup.mock.calls[0].slice(1)).toEqual(['shop-a', id]);
    expect(
      (requestLookup.mock.calls[0][0] as TemplateStringsArray).join('?'),
    ).toContain('"shopId" = ? AND lower("requestId") = ?');
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
              {
                id: 'shop-a',
                name: 'Cafe',
                isActive: true,
                acceptingOrders: true,
              },
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
        raw.mockReset().mockResolvedValue([
          {
            id: 'shop-a',
            name: 'Cafe',
            isActive: true,
            acceptingOrders: true,
          },
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
              {
                id: 'shop-a',
                name: 'Cafe',
                isActive: true,
                acceptingOrders: true,
              },
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
      items: [
        payload().items[0],
        {
          ...payload().items[0],
          productId: '10000000-0000-4000-8000-000000000099',
        },
      ],
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
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date(),
    };
    saved.mockResolvedValue(original);
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
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
  it.each([
    { code: 'P2002', meta: undefined },
    { code: 'P2034', meta: undefined },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
    {
      code: 'P2010',
      meta: {
        code: 'N/A',
        driverAdapterError: { cause: { originalCode: '40001' } },
      },
    },
    {
      code: 'P2010',
      meta: {
        code: 'N/A',
        driverAdapterError: { cause: { originalCode: '40P01' } },
      },
    },
  ])(
    'returns a safe same-request retry for transaction conflict %j',
    async ({ code, meta }) => {
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Fixture transaction conflict',
          { code, meta, clientVersion: 'test' },
        ),
      );
      const result = await post().expect(409);
      expect(result.body.code).toBe('ORDER_RETRY_REQUIRED');
      expect(create).not.toHaveBeenCalled();
      expect(createItems).not.toHaveBeenCalled();
    },
  );
  it('does not classify unrelated raw SQL failures as retryable conflicts', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Fixture SQL error', {
        code: 'P2010',
        meta: { code: '42601' },
        clientVersion: 'test',
      }),
    );
    const result = await post().expect(500);
    expect(result.body.code).toBe('INTERNAL_SERVER_ERROR');
  });
  it.each(['40001', '40P01'])(
    'returns a same-key retry for direct pg adapter commit conflict %s',
    async (originalCode) => {
      const error = new Error('Fixture commit conflict', {
        cause: { kind: 'TransactionWriteConflict', originalCode },
      });
      error.name = 'DriverAdapterError';
      transaction.mockRejectedValueOnce(error);
      const result = await post().expect(409);
      expect(result.body.code).toBe('ORDER_RETRY_REQUIRED');
      expect(create).not.toHaveBeenCalled();
      expect(createItems).not.toHaveBeenCalled();
    },
  );
  it('does not treat an ambiguous adapter connection loss as a confirmed rollback', async () => {
    const error = new Error('Fixture connection failure', {
      cause: { kind: 'ConnectionClosed' },
    });
    error.name = 'DriverAdapterError';
    transaction.mockRejectedValueOnce(error);
    const result = await post().expect(500);
    expect(result.body.code).toBe('INTERNAL_SERVER_ERROR');
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
      status: 'PENDING_CONFIRMATION',
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
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
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
        { id: 'shop-a', name: 'Cafe', isActive: false, acceptingOrders: true },
      ]);
    const replay = await post(takeout()).expect(201);
    expect(replay.body.order.status).toBe('PENDING_CONFIRMATION');
    expect(create).toHaveBeenCalledTimes(1);
    saved.mockResolvedValue(null);
    await post({
      ...takeout(),
      requestId: '10000000-0000-4000-8000-000000000009',
    }).expect(404);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('does not misrepresent an unexpected saved status as PENDING_CONFIRMATION', async () => {
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
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
      ]);
    await post(takeout()).expect(500);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(
    ['CONFIRMED', 'REJECTED'].flatMap((status) =>
      ['DINE_IN', 'TAKEOUT'].map((mode) => ({ status, mode })),
    ),
  )(
    'returns a safe conflict when a $mode retry reaches an already $status order',
    async ({ status, mode }) => {
      const original = mode === 'DINE_IN' ? payload() : takeout();
      await post(original).expect(201);
      saved.mockResolvedValue({
        ...create.mock.calls[0][0].data,
        id: 'order-a',
        status,
        createdAt: new Date(),
      });
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
        ]);
      const reads = readItems.mock.calls.length;
      const result = await post(original).expect(409);
      expect(result.body.code).toBe('ORDER_ALREADY_PROCESSED');
      expect(result.body.order).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('qrToken');
      expect(create).toHaveBeenCalledTimes(1);
      expect(readItems).toHaveBeenCalledTimes(reads);
    },
  );
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
        { id: 'shop-a', name: 'Cafe', isActive: false, acceptingOrders: true },
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
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
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
      expect(result.body.order.subtotalPrice).toBe('56.50');
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
            productId: { in: [id] },
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
          productId: { in: [id] },
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
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'returns saved snapshot names and prices after menu edits for %s',
    async (mode) => {
      const menuProduct = configuredProduct();
      product.mockResolvedValue(menuProduct);
      const body = {
        ...(mode === 'DINE_IN' ? payload() : takeout()),
        items: [configuredLine()],
      };
      const created = await post(body).expect(201);
      const original = { ...create.mock.calls[0][0].data, id: 'order-a' };
      menuProduct.name = 'Renamed coffee';
      menuProduct.price = new Prisma.Decimal('99.00');
      menuProduct.variants[0].name = 'Renamed size';
      menuProduct.variants[0].priceAdjustment = new Prisma.Decimal('88.00');
      menuProduct.addOns[0].addOn.name = 'Renamed milk';
      menuProduct.addOns[0].addOn.priceAdjustment = new Prisma.Decimal('77.00');
      // The compatibility JSON is not the authority for receipt reads.
      saved.mockResolvedValue({ ...original, items: [] });
      product.mockClear();
      raw
        .mockReset()
        .mockResolvedValue([
          { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
        ]);
      const replay = await post(body).expect(201);
      expect(replay.body.order.items).toEqual(created.body.order.items);
      expect(replay.body.order.totalPrice).toBe('34.62');
      expect(product).not.toHaveBeenCalled();
      expect(readItems).toHaveBeenLastCalledWith({
        where: { shopId: 'shop-a', orderId: 'order-a' },
        orderBy: { lineNumber: 'asc' },
      });
    },
  );
  const forgedFields = [
    { scope: 'line', field: 'productNameSnapshot', value: 'Forged name' },
    { scope: 'line', field: 'basePriceSnapshot', value: '0.01' },
    { scope: 'line', field: 'variantsSnapshot', value: [] },
    { scope: 'line', field: 'addOnsSnapshot', value: [] },
    { scope: 'order', field: 'subtotalPrice', value: '0.01' },
    { scope: 'line', field: 'subtotalPrice', value: '0.01' },
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
  it.each(['DINE_IN', 'TAKEOUT'] as const)(
    'calculates exact multi-line subtotal and total from current database amounts for %s',
    async (mode) => {
      const secondId = '10000000-0000-4000-8000-000000000099';
      product.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          where.id === id
            ? configuredProduct('0.10', '0.20', '0.30')
            : {
                ...configuredProduct('0.07'),
                id: secondId,
                optionGroups: [],
                variants: [],
                addOns: [],
              },
      );
      const body = mode === 'DINE_IN' ? payload() : takeout();
      const result = await post({
        ...body,
        items: [
          { ...configuredLine(), quantity: 3 },
          { ...body.items[0], productId: secondId, quantity: 3 },
        ],
      }).expect(201);
      expect(
        result.body.order.items.map(
          (item: { unitPrice: string; totalPrice: string }) => [
            item.unitPrice,
            item.totalPrice,
          ],
        ),
      ).toEqual([
        ['0.60', '1.80'],
        ['0.07', '0.21'],
      ]);
      expect(result.body.order.subtotalPrice).toBe('2.01');
      expect(result.body.order.totalPrice).toBe('2.01');
      expect(create.mock.calls[0][0].data.totalPrice.toFixed(2)).toBe('2.01');
    },
  );
  it('preserves saved prices on replay and reprices a fresh request after menu price changes', async () => {
    product.mockResolvedValue(configuredProduct());
    const body = { ...takeout(), items: [configuredLine()] };
    const original = await post(body).expect(201);
    saved.mockResolvedValue({
      ...create.mock.calls[0][0].data,
      id: 'order-a',
      createdAt: new Date(),
    });
    product
      .mockClear()
      .mockResolvedValue(configuredProduct('20.03', '6.07', '2.15'));
    raw
      .mockReset()
      .mockResolvedValue([
        { id: 'shop-a', name: 'Cafe', isActive: true, acceptingOrders: true },
      ]);
    const replay = await post(body).expect(201);
    expect(replay.body.order.subtotalPrice).toBe(
      original.body.order.subtotalPrice,
    );
    expect(replay.body.order.totalPrice).toBe('34.62');
    expect(product).not.toHaveBeenCalled();
    saved.mockResolvedValue(null);
    const fresh = await post({ ...body, requestId: anotherId }).expect(201);
    expect(fresh.body.order.subtotalPrice).toBe('56.50');
    expect(fresh.body.order.totalPrice).toBe('56.50');
  });
  it('allows a zero-priced order with exact zero subtotal and total', async () => {
    product.mockResolvedValue({
      ...configuredProduct('0.00'),
      optionGroups: [],
      variants: [],
      addOns: [],
    });
    const result = await post(takeout()).expect(201);
    expect(result.body.order.subtotalPrice).toBe('0.00');
    expect(result.body.order.totalPrice).toBe('0.00');
  });
  it('rejects an order exceeding the persisted total range without inserting it', async () => {
    product.mockResolvedValue({
      ...configuredProduct('99999999.99'),
      optionGroups: [],
      variants: [],
      addOns: [],
    });
    const result = await post({
      ...takeout(),
      items: [
        { ...payload().items[0], quantity: 99 },
        { ...payload().items[0], quantity: 99 },
      ],
    }).expect(400);
    expect(result.body.code).toBe('ORDER_TOTAL_TOO_LARGE');
    expect(create).not.toHaveBeenCalled();
  });
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
