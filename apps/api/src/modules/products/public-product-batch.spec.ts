import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PublicProductService } from './public-product.service.js';
import { PublicProductRepository } from './public-product.repository.js';
import type { PrismaService } from '../../database/prisma.service.js';

const row = (id: string, price = '0.10') => ({
  id,
  name: 'Coffee',
  price: new Prisma.Decimal(price),
  status: 'AVAILABLE',
  optionGroups: [],
  variants: [],
  addOns: [],
});
const selection = (productId: string, quantity = 1, notes?: string) => ({
  productId,
  quantity,
  variantIds: [],
  addOnIds: [],
  ...(notes !== undefined ? { notes } : {}),
});
function fixture(rows: ReturnType<typeof row>[]) {
  const repository = { readMany: vi.fn().mockResolvedValue(rows) };
  return {
    repository,
    service: new PublicProductService(
      repository as unknown as PublicProductRepository,
    ),
  };
}
describe('Request-local batched product pricing', () => {
  it('loads only pricing/eligibility/snapshot columns for checkout', async () => {
    const db = {
      shop: { findFirst: vi.fn().mockResolvedValue({ id: randomUUID() }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repository = new PublicProductRepository(
      db as unknown as PrismaService,
    );
    await repository.readMany('cafe', [randomUUID()]);
    const args = db.product.findMany.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual(
      [
        'id',
        'name',
        'price',
        'status',
        'optionGroups',
        'variants',
        'addOns',
      ].sort(),
    );
    expect(args.select.optionGroups.select).toEqual({
      id: true,
      isRequired: true,
    });
    expect(args.take).toBe(1);
  });
  it('loads unique identities once, preserves original line order and prices repeated selections independently', async () => {
    const a = randomUUID(),
      b = randomUUID();
    const { service, repository } = fixture([row(b, '0.20'), row(a)]);
    const transaction = {} as Prisma.TransactionClient;
    const quotes = await service.quoteMany(
      'cafe',
      [
        selection(a, 2, '  Less ice  '),
        selection(b, 3),
        selection(a, 1, 'No sugar'),
      ],
      transaction,
    );
    expect(repository.readMany).toHaveBeenCalledExactlyOnceWith(
      'cafe',
      [a, b],
      transaction,
    );
    expect(quotes.map((q) => q.productId)).toEqual([a, b, a]);
    expect(quotes.map((q) => q.totalPrice)).toEqual(['0.20', '0.60', '0.10']);
    expect(quotes.map((q) => q.notes)).toEqual([
      'Less ice',
      undefined,
      'No sugar',
    ]);
  });
  it('rejects the whole batch if a requested identity is absent or unorderable', async () => {
    const a = randomUUID(),
      b = randomUUID();
    const { service, repository } = fixture([row(a)]);
    await expect(
      service.quoteMany('cafe', [selection(a), selection(b)]),
    ).rejects.toMatchObject({ status: 404 });
    repository.readMany.mockResolvedValue([{ ...row(a), status: 'SOLD_OUT' }]);
    await expect(
      service.quoteMany('cafe', [selection(a)]),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('does not cache product data across requests', async () => {
    const id = randomUUID();
    const { service, repository } = fixture([row(id)]);
    expect(
      (await service.quoteMany('cafe', [selection(id)]))[0].totalPrice,
    ).toBe('0.10');
    repository.readMany.mockResolvedValue([row(id, '1.25')]);
    expect(
      (await service.quoteMany('cafe', [selection(id)]))[0].totalPrice,
    ).toBe('1.25');
    expect(repository.readMany).toHaveBeenCalledTimes(2);
  });
  it.each([
    [],
    Array.from({ length: 101 }, () => selection(randomUUID())),
    [selection(randomUUID(), 100)],
  ])('rejects unbounded or invalid selections before reads', async (lines) => {
    const { service, repository } = fixture([]);
    await expect(service.quoteMany('cafe', lines)).rejects.toMatchObject({
      status: 400,
    });
    expect(repository.readMany).not.toHaveBeenCalled();
  });
});
