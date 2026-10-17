import { salesMonthlyRange } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Monthly analytics', () => {
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
    ['2026-02-15', '2026-02-01', '2026-02-28'],
    ['2028-02-29', '2028-02-01', '2028-02-29'],
    ['1900-02-01', '1900-02-01', '1900-02-28'],
    ['2000-02-29', '2000-02-01', '2000-02-29'],
    ['2026-04-30', '2026-04-01', '2026-04-30'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2027-01-01', '2027-01-01', '2027-01-31'],
    ['0001-02-01', '0001-02-01', '0001-02-28'],
    ['9999-12-31', '9999-12-01', '9999-12-31'],
  ])('uses calendar boundaries for %s', (date, monthStart, monthEnd) => {
    expect(salesMonthlyRange(date, date)?.months).toEqual([
      {
        month: date.slice(0, 7),
        monthStart,
        monthEnd,
        fromDate: date,
        toDate: date,
        partial: true,
      },
    ]);
  });
  it('clips partial months, preserves exact totals, and includes empty months', async () => {
    raw.mockResolvedValue([
      {
        businessDate: '2026-12-31',
        completedOrders: 2n,
        totalSales: new Prisma.Decimal('9999999999999.99'),
        itemsSold: new Prisma.Decimal(7),
      },
      {
        businessDate: '2027-01-01',
        completedOrders: 1n,
        totalSales: new Prisma.Decimal('0.01'),
        itemsSold: new Prisma.Decimal(1),
      },
      {
        businessDate: '2027-01-02',
        completedOrders: 1n,
        totalSales: new Prisma.Decimal('0.00'),
        itemsSold: new Prisma.Decimal(1),
      },
    ]);
    const result = await service.monthlyAnalytics(
      actorId,
      shopId,
      '2026-12-15',
      '2027-03-02',
    );
    expect(result).toMatchObject({
      aggregation: 'CALENDAR_MONTH',
      completedOrders: 4,
      itemsSold: 9,
      totalSales: '10000000000000.00',
      from: '2026-12-14T16:00:00.000Z',
      to: '2027-03-02T16:00:00.000Z',
    });
    expect(
      result.months.map((m) => [
        m.month,
        m.completedOrders,
        m.totalSales,
        m.partial,
      ]),
    ).toEqual([
      ['2026-12', 2, '9999999999999.99', true],
      ['2027-01', 2, '0.01', false],
      ['2027-02', 0, '0.00', false],
      ['2027-03', 0, '0.00', true],
    ]);
    expect(result.months[0].fromDate).toBe('2026-12-15');
    expect(result.months[3].toDate).toBe('2027-03-02');
    expect(raw).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('supports full months and all 12 months in a leap year', () => {
    const range = salesMonthlyRange('2028-01-01', '2028-12-31');
    expect(range?.months).toHaveLength(12);
    expect(range?.months.every((month) => !month.partial)).toBe(true);
    expect(salesMonthlyRange('2027-07-15', '2028-07-14')?.months).toHaveLength(
      13,
    );
  });
  it.each([
    [undefined, '2026-10-18'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-19', '2026-10-18'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-18'], '2026-10-18'],
  ])('rejects invalid ranges before reading', async (start, end) => {
    await expect(
      service.monthlyAnalytics(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('checks current access before serving an empty month', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.monthlyAnalytics(actorId, shopId, '2026-10-01', '2026-10-31'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
