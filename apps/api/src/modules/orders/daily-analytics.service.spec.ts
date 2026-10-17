import { salesDailyRange } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';
const actorId = 'a47f6994-a303-4a7b-87b0-2386d5198828';
const shopId = 'b47f6994-a303-4a7b-87b0-2386d5198828';

describe('Daily analytics range', () => {
  const shop = vi.fn(),
    raw = vi.fn();
  const tx = { shop: { findFirst: shop }, $queryRaw: raw };
  const transaction = vi.fn(async (work) => work(tx));
  const service = new CompletedSalesService({
    $transaction: transaction,
  } as unknown as PrismaService);
  beforeEach(() => {
    vi.clearAllMocks();
    shop.mockResolvedValue({ id: 'shop' });
    raw.mockResolvedValue([]);
  });
  it.each([
    [undefined, '2026-10-16'],
    ['2026-02-30', '2026-03-01'],
    ['2026-10-17', '2026-10-16'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-16'], '2026-10-16'],
  ])(
    'rejects invalid range %s to %s before database access',
    async (start, end) => {
      await expect(
        service.dailyAnalytics('actor', 'shop', start, end),
      ).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('includes leap day and permits exactly 366 days', () => {
    expect(salesDailyRange('2028-02-28', '2028-03-01')?.dates).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(salesDailyRange('2028-01-01', '2028-12-31')?.dates).toHaveLength(
      366,
    );
  });
  it('fills empty days and preserves exact decimal totals', async () => {
    raw.mockResolvedValue([
      {
        businessDate: '2026-10-15',
        completedOrders: 2n,
        totalSales: new Prisma.Decimal('9999999999999.99'),
        itemsSold: new Prisma.Decimal(7),
      },
      {
        businessDate: '2026-10-17',
        completedOrders: 1n,
        totalSales: new Prisma.Decimal('0.01'),
        itemsSold: new Prisma.Decimal(1),
      },
    ]);
    const result = await service.dailyAnalytics(
      actorId,
      shopId,
      '2026-10-15',
      '2026-10-17',
    );
    expect(result).toMatchObject({
      from: '2026-10-14T16:00:00.000Z',
      to: '2026-10-17T16:00:00.000Z',
      totalSales: '10000000000000.00',
      completedOrders: 3,
      itemsSold: 8,
    });
    expect(result.days[1]).toEqual({
      businessDate: '2026-10-16',
      totalSales: '0.00',
      completedOrders: 0,
      itemsSold: 0,
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(shop.mock.calls[0][0].where).toMatchObject({ id: shopId });
    const sql = raw.mock.calls[0][0].join('?');
    expect(sql).toContain('o."shopId" = ?');
    expect(sql).toContain('i."shopId" = ?');
    expect(sql).toContain('o."completedAt" < ?');
  });
  it('rejects lost access even for an empty range', async () => {
    shop.mockResolvedValue(null);
    await expect(
      service.dailyAnalytics(actorId, shopId, '2026-10-16', '2026-10-16'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
