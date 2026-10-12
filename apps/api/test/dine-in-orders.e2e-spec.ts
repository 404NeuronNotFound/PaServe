import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { requestValidationPipe } from '../src/common/pipes/request-validation.pipe.js';

const id = '10000000-0000-4000-8000-000000000001';
const payload = () => ({
  requestId: id,
  tableCode: 'T12',
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
  const saved = vi.fn();
  const create = vi.fn();
  const tx = {
    $queryRaw: raw,
    shop: { findFirst: vi.fn() },
    product: { findFirst: product },
    order: { findUnique: saved, create },
  };
  const transaction = vi.fn((callback: (db: typeof tx) => unknown) =>
    callback(tx),
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $transaction: transaction })
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
    vi.clearAllMocks();
    raw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'shop-a' }])
      .mockResolvedValueOnce([{ id: 'table-a', number: 'Patio 4' }]);
    saved.mockReset().mockResolvedValue(null);
    tx.shop.findFirst.mockResolvedValue({ id: 'shop-a' });
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
      status: 'PLACED',
      createdAt: new Date('2026-10-12T00:00:00Z'),
    }));
  });
  const post = (body: unknown = payload()) =>
    request(app.getHttpServer()).post('/api/v1/menu/cafe/orders').send(body);
  it('inherits DINE_IN and binds a server-resolved shop/table with authoritative prices', async () => {
    const result = await post().expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.order).toMatchObject({
      mode: 'DINE_IN',
      status: 'PLACED',
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
    });
  });
  it('accepts explicit dine-in mode', async () => {
    await post({ ...payload(), mode: 'DINE_IN' }).expect(201);
  });
  it.each([
    { ...payload(), mode: 'TAKEAWAY' },
    { ...payload(), mode: null },
    { ...payload(), tableCode: undefined },
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
      .mockResolvedValueOnce([{ id: 'shop-a' }])
      .mockResolvedValueOnce([]);
    await post().expect(404);
    expect(product).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(raw.mock.calls[1][1]).toBe('shop-a');
    expect(raw.mock.calls[1][2]).toBe('T12');
    expect(raw.mock.calls[1][0].join('?')).toContain('AND "isActive" = true FOR SHARE');
  });
  it('rejects inactive shops', async () => {
    raw.mockReset().mockResolvedValue([]);
    await post().expect(404);
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
      status: 'PLACED',
      createdAt: new Date(),
    };
    saved.mockResolvedValue(original);
    raw.mockReset().mockResolvedValue([{ id: 'shop-a' }]);
    const replay = await post().expect(201);
    expect(replay.body.order.id).toBe('order-a');
    expect(create).toHaveBeenCalledTimes(1);
    await post({ ...payload(), tableCode: 'T13' }).expect(409);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
