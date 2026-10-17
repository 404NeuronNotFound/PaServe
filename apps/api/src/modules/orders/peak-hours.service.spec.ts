import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';
describe('Peak hours', () => {
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
  it('fills 24 local hours, reconciles totals and returns all busiest ties', async () => {
    raw.mockResolvedValue([
      {
        hour: 0,
        completedOrders: 2n,
        totalSales: new Prisma.Decimal('9999999999999.99'),
      },
      { hour: 23, completedOrders: 2n, totalSales: new Prisma.Decimal('0.01') },
    ]);
    const report = await service.peakHours(
      actorId,
      shopId,
      '2026-10-15',
      '2026-10-17',
    );
    expect(report).toMatchObject({
      from: '2026-10-14T16:00:00.000Z',
      to: '2026-10-17T16:00:00.000Z',
      timezone: 'Asia/Manila',
      timeBasis: 'COMPLETED_AT',
      completedOrders: 4,
      totalSales: '10000000000000.00',
      peakHours: [0, 23],
    });
    expect(report.hours).toHaveLength(24);
    expect(report.hours[1]).toEqual({
      hour: 1,
      completedOrders: 0,
      totalSales: '0.00',
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    const sql = raw.mock.calls[0][0].join('?');
    expect(sql).toContain("AT TIME ZONE 'Asia/Manila'");
    expect(sql).toContain('o."shopId" = ?');
    expect(sql).toContain('o."paymentStatus" = \'PAID\'');
    expect(sql).toContain("o.status = 'CONFIRMED'");
    expect(sql).not.toContain('JOIN');
  });
  it('returns no peak for an empty period and retains all zero buckets', async () => {
    const report = await service.peakHours(
      actorId,
      shopId,
      '2026-10-16',
      '2026-10-16',
    );
    expect(report).toMatchObject({
      peakHours: [],
      completedOrders: 0,
      totalSales: '0.00',
    });
    expect(
      report.hours.every(
        (hour) => hour.completedOrders === 0 && hour.totalSales === '0.00',
      ),
    ).toBe(true);
  });
  it('counts zero-total paid orders when identifying peak hours', async () => {
    raw.mockResolvedValue([
      { hour: 8, completedOrders: 3n, totalSales: new Prisma.Decimal(0) },
    ]);
    expect(
      await service.peakHours(actorId, shopId, '2026-10-16', '2026-10-16'),
    ).toMatchObject({ completedOrders: 3, totalSales: '0.00', peakHours: [8] });
  });
  it.each([
    [undefined, '2026-10-16'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-17', '2026-10-16'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-16'], '2026-10-16'],
  ])('rejects invalid ranges before reading', async (start, end) => {
    await expect(
      service.peakHours(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rechecks live access even for an empty report', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.peakHours(actorId, shopId, '2026-10-16', '2026-10-16'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
