import { salesWeeklyRange } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Weekly analytics', () => {
  const actorId = 'a47f6994-a303-4a7b-87b0-2386d5198828';
  const shopId = 'b47f6994-a303-4a7b-87b0-2386d5198828';
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
    ['2026-10-18', '2026-10-12', '2026-10-18'],
    ['2026-10-19', '2026-10-19', '2026-10-25'],
    ['2027-01-01', '2026-12-28', '2027-01-03'],
    ['2027-01-04', '2027-01-04', '2027-01-10'],
    ['2028-02-29', '2028-02-28', '2028-03-05'],
  ])('uses Monday-Sunday boundaries for %s', (date, weekStart, weekEnd) => {
    expect(salesWeeklyRange(date, date)?.weeks).toEqual([
      { weekStart, weekEnd, fromDate: date, toDate: date, partial: true },
    ]);
  });
  it('clips boundary weeks without extending the selected range', async () => {
    raw.mockResolvedValue([
      {
        businessDate: '2026-10-18',
        completedOrders: 2n,
        totalSales: new Prisma.Decimal('9999999999999.99'),
        itemsSold: new Prisma.Decimal(7),
      },
      {
        businessDate: '2026-10-19',
        completedOrders: 1n,
        totalSales: new Prisma.Decimal('0.01'),
        itemsSold: new Prisma.Decimal(1),
      },
    ]);
    const report = await service.weeklyAnalytics(
      actorId,
      shopId,
      '2026-10-14',
      '2026-10-28',
    );
    expect(report.weeks).toEqual([
      {
        weekStart: '2026-10-12',
        weekEnd: '2026-10-18',
        fromDate: '2026-10-14',
        toDate: '2026-10-18',
        partial: true,
        completedOrders: 2,
        totalSales: '9999999999999.99',
        itemsSold: 7,
      },
      {
        weekStart: '2026-10-19',
        weekEnd: '2026-10-25',
        fromDate: '2026-10-19',
        toDate: '2026-10-25',
        partial: false,
        completedOrders: 1,
        totalSales: '0.01',
        itemsSold: 1,
      },
      {
        weekStart: '2026-10-26',
        weekEnd: '2026-11-01',
        fromDate: '2026-10-26',
        toDate: '2026-10-28',
        partial: true,
        completedOrders: 0,
        totalSales: '0.00',
        itemsSold: 0,
      },
    ]);
    expect(report).toMatchObject({
      totalSales: '10000000000000.00',
      completedOrders: 3,
      itemsSold: 8,
      weekStartsOn: 'MONDAY',
      from: '2026-10-13T16:00:00.000Z',
      to: '2026-10-28T16:00:00.000Z',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(raw).toHaveBeenCalledTimes(1);
  });
  it('supports a complete week, a leap year range and a cross-year week', () => {
    expect(salesWeeklyRange('2026-12-28', '2027-01-03')?.weeks[0].partial).toBe(
      false,
    );
    const range = salesWeeklyRange('2028-01-01', '2028-12-31');
    expect(range?.weeks[0].weekStart).toBe('2027-12-27');
    expect(range?.weeks.at(-1)?.weekEnd).toBe('2028-12-31');
  });
  it.each([
    [undefined, '2026-10-18'],
    ['2026-02-30', '2026-03-01'],
    ['2026-10-19', '2026-10-18'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-18'], '2026-10-18'],
  ])('rejects invalid ranges before reading', async (start, end) => {
    await expect(
      service.weeklyAnalytics(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rechecks access for empty weeks', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.weeklyAnalytics(actorId, shopId, '2026-10-19', '2026-10-25'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
