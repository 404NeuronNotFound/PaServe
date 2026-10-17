import { salesTrendRanges } from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Sales trends', () => {
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
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({ id: shopId });
    raw.mockResolvedValue([]);
  });
  it.each([
    ['2026-01-01', '2026-01-03', '2025-12-29', '2025-12-31'],
    ['2028-03-01', '2028-03-01', '2028-02-29', '2028-02-29'],
    ['2026-10-17', '2026-10-17', '2026-10-16', '2026-10-16'],
  ])(
    'defines adjacent equal-length Manila ranges',
    (start, end, priorStart, priorEnd) => {
      const range = salesTrendRanges(start, end)!;
      expect(range.previous.dates[0]).toBe(priorStart);
      expect(range.previous.dates.at(-1)).toBe(priorEnd);
      expect(range.previous.dates.length).toBe(range.current.dates.length);
      expect(range.previous.to).toBe(range.current.from);
    },
  );
  it.each([
    ['0001-01-01', '0001-01-01'],
    ['2026-02-29', '2026-03-01'],
    ['2026-01-02', '2026-01-01'],
    ['2026-01-01', '2027-01-02'],
    [undefined, '2026-01-01'],
    [['2026-01-01'], '2026-01-01'],
  ])('rejects invalid or unrepresentable periods', async (start, end) => {
    await expect(
      service.salesTrends(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('accepts 366 days per period and limits the result to 732 rows', async () => {
    const result = await service.salesTrends(
      actorId,
      shopId,
      '2028-01-01',
      '2028-12-31',
    );
    expect(result.current.days).toHaveLength(366);
    expect(result.previous.days).toHaveLength(366);
    expect(raw).toHaveBeenCalledTimes(1);
  });
  it('reconciles both periods from one exact aggregate with zero-filled days', async () => {
    raw.mockResolvedValue([
      {
        businessDate: '2026-10-13',
        completedOrders: 2n,
        totalSales: new Prisma.Decimal('90071992547409.93'),
      },
      {
        businessDate: '2026-10-15',
        completedOrders: 1n,
        totalSales: new Prisma.Decimal('0.00'),
      },
      {
        businessDate: '2026-10-16',
        completedOrders: 3n,
        totalSales: new Prisma.Decimal('10.01'),
      },
    ]);
    const result = await service.salesTrends(
      actorId,
      shopId,
      '2026-10-15',
      '2026-10-16',
    );
    expect(result).toMatchObject({
      shopId: shopId,
      timezone: 'Asia/Manila',
      comparisonBasis: 'PREVIOUS_EQUAL_PERIOD',
      current: { completedOrders: 4, totalSales: '10.01' },
      previous: { completedOrders: 2, totalSales: '90071992547409.93' },
    });
    expect(result.previous.days[1]).toEqual({
      businessDate: '2026-10-14',
      completedOrders: 0,
      totalSales: '0.00',
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    const [sql, ...values] = raw.mock.calls[0];
    const query = sql.join('?');
    for (const predicate of [
      'o."shopId" = ?',
      "o.status = 'CONFIRMED'",
      'o."paymentStatus" = \'PAID\'',
      'o."preparationStatus" = \'COMPLETED\'',
      'o."completedBy" IS NOT NULL',
      "o.currency = 'PHP'",
      "AT TIME ZONE 'Asia/Manila'",
    ])
      expect(query).toContain(predicate);
    expect(query).not.toContain('JOIN');
    expect(values).toEqual([
      shopId,
      new Date('2026-10-12T16:00:00.000Z'),
      new Date('2026-10-16T16:00:00.000Z'),
    ]);
  });
  it('rechecks live shop access before the aggregate', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.salesTrends(actorId, shopId, '2026-10-15', '2026-10-16'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects unsafe order counts', async () => {
    raw.mockResolvedValue([
      {
        businessDate: '2026-10-15',
        completedOrders: 9007199254740992n,
        totalSales: new Prisma.Decimal('0'),
      },
    ]);
    await expect(
      service.salesTrends(actorId, shopId, '2026-10-15', '2026-10-16'),
    ).rejects.toMatchObject({ status: 500 });
  });
});
