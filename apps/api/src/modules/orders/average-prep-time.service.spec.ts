import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';
describe('Average preparation time', () => {
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
  const row = () => ({
    eligibleOrders: 5n,
    measuredOrders: 2n,
    missingTimestamps: 2n,
    invalidTimestamps: 1n,
    totalDurationMs: '90001',
  });
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({ id: shopId });
    raw.mockResolvedValue([row()]);
  });
  it('uses only valid Preparing-to-Ready pairs with an explicit sample denominator', async () => {
    const report = await service.averagePrepTime(
      actorId,
      shopId,
      '2026-10-15',
      '2026-10-17',
    );
    expect(report).toMatchObject({
      eligibleOrders: 5,
      measuredOrders: 2,
      excludedOrders: 3,
      missingTimestamps: 2,
      invalidTimestamps: 1,
      totalDurationMs: '90001',
      averageDurationMs: 45001,
      durationBasis: 'PREPARING_TO_READY',
      selectionBasis: 'COMPLETED_AT',
      timezone: 'Asia/Manila',
      from: '2026-10-14T16:00:00.000Z',
      to: '2026-10-17T16:00:00.000Z',
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    const sql = raw.mock.calls[0][0].join('?');
    expect(sql).toContain('o."preparationReadyAt" - o."preparationStartedAt"');
    expect(sql).toContain(
      'o."preparationStartedAt" IS NULL OR o."preparationReadyAt" IS NULL',
    );
    expect(sql).toContain('o."preparationReadyAt" > o."completedAt"');
    expect(sql).toContain('o."shopId" = ?');
    expect(sql).not.toContain('JOIN');
  });
  it.each([
    {
      eligibleOrders: 0n,
      measuredOrders: 0n,
      missingTimestamps: 0n,
      invalidTimestamps: 0n,
      totalDurationMs: '0',
    },
    {
      eligibleOrders: 3n,
      measuredOrders: 0n,
      missingTimestamps: 2n,
      invalidTimestamps: 1n,
      totalDurationMs: '0',
    },
  ])('returns no average for an empty sample', async (empty) => {
    raw.mockResolvedValue([empty]);
    expect(
      await service.averagePrepTime(
        actorId,
        shopId,
        '2026-10-16',
        '2026-10-16',
      ),
    ).toMatchObject({
      measuredOrders: 0,
      averageDurationMs: null,
      totalDurationMs: '0',
    });
  });
  it('includes a valid zero duration and supports durations longer than a day', async () => {
    raw.mockResolvedValue([
      {
        eligibleOrders: 1n,
        measuredOrders: 1n,
        missingTimestamps: 0n,
        invalidTimestamps: 0n,
        totalDurationMs: '0',
      },
    ]);
    expect(
      (
        await service.averagePrepTime(
          actorId,
          shopId,
          '2026-10-16',
          '2026-10-16',
        )
      ).averageDurationMs,
    ).toBe(0);
    raw.mockResolvedValue([
      {
        eligibleOrders: 2n,
        measuredOrders: 2n,
        missingTimestamps: 0n,
        invalidTimestamps: 0n,
        totalDurationMs: '180000000',
      },
    ]);
    expect(
      (
        await service.averagePrepTime(
          actorId,
          shopId,
          '2026-10-16',
          '2026-10-16',
        )
      ).averageDurationMs,
    ).toBe(90000000);
  });
  it('does not silently accept inconsistent sample counts', async () => {
    raw.mockResolvedValue([{ ...row(), eligibleOrders: 6n }]);
    await expect(
      service.averagePrepTime(actorId, shopId, '2026-10-16', '2026-10-16'),
    ).rejects.toMatchObject({ status: 500 });
  });
  it.each([
    [undefined, '2026-10-16'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-17', '2026-10-16'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-16'], '2026-10-16'],
  ])('rejects invalid date ranges', async (start, end) => {
    await expect(
      service.averagePrepTime(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rechecks access before reading preparation timestamps', async () => {
    access.mockResolvedValue(null);
    await expect(
      service.averagePrepTime(actorId, shopId, '2026-10-16', '2026-10-16'),
    ).rejects.toMatchObject({ status: 404 });
    expect(raw).not.toHaveBeenCalled();
  });
});
