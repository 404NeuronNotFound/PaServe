import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Custom sales', () => {
  const actorId = 'a47f6994-a303-4a7b-87b0-2386d5198828',
    shopId = 'b47f6994-a303-4a7b-87b0-2386d5198828';
  const shop = vi.fn(),
    aggregate = vi.fn(),
    items = vi.fn(),
    groups = vi.fn(),
    recent = vi.fn();
  const tx = {
    shop: { findFirst: shop },
    order: { aggregate, groupBy: groups, findMany: recent },
    orderItem: { aggregate: items },
  };
  const transaction = vi.fn(async (work) => work(tx));
  const service = new CompletedSalesService({
    $transaction: transaction,
  } as unknown as PrismaService);
  beforeEach(() => {
    vi.clearAllMocks();
    shop.mockResolvedValue({ id: shopId });
    aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { totalPrice: new Prisma.Decimal('0.30') },
    });
    items.mockResolvedValue({ _sum: { quantity: 7 } });
    groups.mockResolvedValue([
      {
        paymentMethod: 'CASH',
        _count: { _all: 2 },
        _sum: { totalPrice: new Prisma.Decimal('0.30') },
      },
    ]);
    recent.mockResolvedValue([]);
  });
  it('uses identical shop, eligibility and inclusive date bounds for every metric in one snapshot', async () => {
    const report = await service.custom(
      actorId,
      shopId,
      '2026-10-15',
      '2026-10-17',
    );
    const expected = {
      shopId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      preparationStatus: 'COMPLETED',
      currency: 'PHP',
      completedBy: { not: null },
      completedAt: {
        gte: new Date('2026-10-14T16:00:00.000Z'),
        lt: new Date('2026-10-17T16:00:00.000Z'),
      },
    };
    expect(aggregate.mock.calls[0][0].where).toMatchObject(expected);
    expect(groups.mock.calls[0][0].where).toEqual(
      aggregate.mock.calls[0][0].where,
    );
    expect(recent.mock.calls[0][0].where).toEqual(
      aggregate.mock.calls[0][0].where,
    );
    expect(items.mock.calls[0][0].where).toEqual({
      shopId,
      order: aggregate.mock.calls[0][0].where,
    });
    expect(report).toMatchObject({
      startDate: '2026-10-15',
      endDate: '2026-10-17',
      from: '2026-10-14T16:00:00.000Z',
      to: '2026-10-17T16:00:00.000Z',
      totalSales: '0.30',
      completedOrders: 2,
      itemsSold: 7,
    });
    expect(report).not.toHaveProperty('businessDate');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('matches the existing daily contract for a one-day range', async () => {
    const custom = await service.custom(
      actorId,
      shopId,
      '2028-02-29',
      '2028-02-29',
    );
    const { businessDate: _date, ...daily } = await service.daily(
      actorId,
      shopId,
      '2028-02-29',
    );
    const { startDate: _start, endDate: _end, ...range } = custom;
    expect(range).toEqual(daily);
  });
  it.each([
    [undefined, '2026-10-17'],
    ['', '2026-10-17'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-18', '2026-10-17'],
    ['2026-01-01', '2027-01-02'],
    [['2026-10-16'], '2026-10-17'],
  ])('rejects invalid ranges before reading', async (start, end) => {
    await expect(
      service.custom(actorId, shopId, start, end),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('checks live access before returning even an empty report', async () => {
    shop.mockResolvedValue(null);
    await expect(
      service.custom(actorId, shopId, '2026-10-15', '2026-10-17'),
    ).rejects.toMatchObject({ status: 404 });
    expect(aggregate).not.toHaveBeenCalled();
    expect(groups).not.toHaveBeenCalled();
    expect(items).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });
  it('rejects payment groups that cannot reconcile with the selected range', async () => {
    groups.mockResolvedValue([]);
    await expect(
      service.custom(actorId, shopId, '2026-10-15', '2026-10-17'),
    ).rejects.toMatchObject({ status: 500 });
  });
});
