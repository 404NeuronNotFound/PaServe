import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Top products', () => {
  const actorId = 'a47f6994-a303-4a7b-87b0-2386d5198828',
    shopId = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const access = vi.fn(),
    raw = vi.fn();
  const transaction = vi.fn(async (work) =>
    work({ shop: { findFirst: access }, $queryRaw: raw }),
  );
  const service = new CompletedSalesService({
    $transaction: transaction,
  } as unknown as PrismaService);
  const row = (id = 'saved-a', quantity = 5, revenue = '1.00') => ({
    productSnapshotId: id,
    productName: 'Historical coffee',
    quantity: BigInt(quantity),
    revenue: new Prisma.Decimal(revenue),
    totalQuantity: new Prisma.Decimal(7),
    totalRevenue: new Prisma.Decimal('11.00'),
    productCount: 2n,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({ id: shopId });
    raw.mockResolvedValue([]);
  });
  it.each(['QUANTITY', 'REVENUE'] as const)(
    'returns saved identifiers/names and exact totals ranked by %s',
    async (metric) => {
      const products = [row(), row('saved-b', 2, '10.00')];
      raw.mockResolvedValue(
        metric === 'QUANTITY' ? products : products.reverse(),
      );
      const result = await service.topProducts(
        actorId,
        shopId,
        '2026-10-15',
        '2026-10-17',
        metric,
      );
      expect(result).toMatchObject({
        shopId,
        startDate: '2026-10-15',
        endDate: '2026-10-17',
        from: '2026-10-14T16:00:00.000Z',
        to: '2026-10-17T16:00:00.000Z',
        metric,
        productCount: 2,
        totalQuantity: 7,
        totalRevenue: '11.00',
        otherQuantity: 0,
        otherRevenue: '0.00',
      });
      expect(result.products[0].productSnapshotId).toBe(
        metric === 'QUANTITY' ? 'saved-a' : 'saved-b',
      );
      expect(result.products[0].productName).toBe('Historical coffee');
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
      const sql = raw.mock.calls[0][0].join('?');
      expect(sql).toContain('i."shopId" = ? AND o."shopId" = ?');
      expect(sql).toContain('sum(i."lineTotalSnapshot")');
      expect(sql).not.toContain('JOIN products');
      expect(raw.mock.calls[0].at(-1).sql).toBe(
        metric === 'QUANTITY'
          ? 'quantity DESC, revenue DESC'
          : 'revenue DESC, quantity DESC',
      );
    },
  );
  it('retains exact totals above the safe floating-point cent range', async () => {
    raw.mockResolvedValue([
      {
        ...row(),
        productCount: 1n,
        totalQuantity: new Prisma.Decimal(5),
        revenue: new Prisma.Decimal('123456789012345.67'),
        totalRevenue: new Prisma.Decimal('123456789012345.67'),
      },
    ]);
    const report = await service.topProducts(
      actorId,
      shopId,
      '2026-10-16',
      '2026-10-16',
      'REVENUE',
    );
    expect(report.totalRevenue).toBe('123456789012345.67');
    expect(report.products[0].revenue).toBe(report.totalRevenue);
  });
  it('returns remainder totals across all products, not only ten displayed rows', async () => {
    raw.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        ...row(`product-${i}`, 1),
        totalQuantity: new Prisma.Decimal(12),
        totalRevenue: new Prisma.Decimal('11.25'),
        productCount: 12n,
      })),
    );
    const report = await service.topProducts(
      actorId,
      shopId,
      '2026-10-16',
      '2026-10-16',
      'QUANTITY',
    );
    expect(report).toMatchObject({
      productCount: 12,
      totalQuantity: 12,
      totalRevenue: '11.25',
      otherQuantity: 2,
      otherRevenue: '1.25',
    });
  });
  it('returns an explicit empty report', async () => {
    expect(
      await service.topProducts(
        actorId,
        shopId,
        '2026-10-16',
        '2026-10-16',
        'QUANTITY',
      ),
    ).toMatchObject({
      products: [],
      productCount: 0,
      totalQuantity: 0,
      totalRevenue: '0.00',
      otherQuantity: 0,
      otherRevenue: '0.00',
    });
  });
  it.each([undefined, 'PRICE', ['QUANTITY'], 'revenue'])(
    'rejects invalid metric %j',
    async (metric) => {
      await expect(
        service.topProducts(
          actorId,
          shopId,
          '2026-10-16',
          '2026-10-16',
          metric,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    [undefined, '2026-10-16'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-17', '2026-10-16'],
    ['2026-01-01', '2027-01-02'],
  ])('rejects invalid ranges', async (start, end) => {
    await expect(
      service.topProducts(actorId, shopId, start, end, 'QUANTITY'),
    ).rejects.toMatchObject({ status: 400 });
    expect(raw).not.toHaveBeenCalled();
  });
  it('checks current access even for no sales', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.topProducts(
        actorId,
        shopId,
        '2026-10-16',
        '2026-10-16',
        'QUANTITY',
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
