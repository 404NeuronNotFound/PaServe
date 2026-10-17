import { randomUUID } from 'node:crypto';
import {
  SALES_PAYMENT_METHODS,
  salesBusinessDate,
  salesBusinessDayBounds,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Daily gross sales', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const aggregate = vi.fn();
  const aggregateItems = vi.fn();
  const groupBy = vi.fn();
  const findMany = vi.fn();
  const findShop = vi.fn();
  const database = {
    shop: { findFirst: findShop },
    order: { aggregate, groupBy, findMany },
    orderItem: { aggregate: aggregateItems },
  };
  const transaction = vi.fn(async (work: (tx: typeof database) => unknown) =>
    work(database),
  );
  const service = new CompletedSalesService({
    ...database,
    $transaction: transaction,
  } as unknown as PrismaService);
  beforeEach(() => {
    vi.resetAllMocks();
    findShop.mockResolvedValue({ id: shopId });
    aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { totalPrice: null },
    });
    aggregateItems.mockResolvedValue({ _sum: { quantity: null } });
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);
    transaction.mockImplementation(async (work) => work(database));
  });

  it('uses midnight in Manila, regardless of the host timezone', () => {
    expect(salesBusinessDate(new Date('2026-10-15T15:59:59.999Z'))).toBe(
      '2026-10-15',
    );
    expect(salesBusinessDate(new Date('2026-10-15T16:00:00.000Z'))).toBe(
      '2026-10-16',
    );
    expect(salesBusinessDayBounds('2026-10-16')).toEqual({
      from: '2026-10-15T16:00:00.000Z',
      to: '2026-10-16T16:00:00.000Z',
    });
    expect(salesBusinessDayBounds('2028-02-29')).toEqual({
      from: '2028-02-28T16:00:00.000Z',
      to: '2028-02-29T16:00:00.000Z',
    });
    expect(salesBusinessDayBounds('2026-12-31')?.to).toBe(
      '2026-12-31T16:00:00.000Z',
    );
  });
  it.each([
    undefined,
    '',
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-1-01',
    '0000-01-01',
    ['2026-10-16'],
    '2026-10-16T00:00:00Z',
  ])('rejects invalid business date %j before querying', async (date) => {
    await expect(service.daily(actorId, shopId, date)).rejects.toMatchObject({
      response: { code: 'INVALID_SALES_DATE' },
    });
    expect(aggregate).not.toHaveBeenCalled();
  });
  it('returns exact saved totals and uses the same scoped eligibility as the period report', async () => {
    groupBy.mockResolvedValue([
      {
        paymentMethod: 'CASH',
        _count: { _all: 200 },
        _sum: { totalPrice: new Prisma.Decimal('12345678901234.30') },
      },
    ]);
    aggregate.mockResolvedValue({
      _count: { _all: 200 },
      _sum: { totalPrice: new Prisma.Decimal('12345678901234.30') },
    });
    const daily = await service.daily(actorId, shopId, '2026-10-16');
    expect(daily).toEqual({
      shopId,
      businessDate: '2026-10-16',
      timezone: 'Asia/Manila',
      from: '2026-10-15T16:00:00.000Z',
      to: '2026-10-16T16:00:00.000Z',
      currency: 'PHP',
      completedOrders: 200,
      totalSales: '12345678901234.30',
      itemsSold: 0,
      recentOrders: [],
      paymentBreakdown: SALES_PAYMENT_METHODS.map((paymentMethod) => ({
        paymentMethod,
        orders: paymentMethod === 'CASH' ? 200 : 0,
        totalSales: paymentMethod === 'CASH' ? '12345678901234.30' : '0.00',
      })),
    });
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        shopId,
        shop: {
          id: shopId,
          isActive: true,
          members: {
            some: {
              userId: actorId,
              disabledAt: null,
              role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
              user: { isActive: true },
            },
          },
        },
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        completedBy: { not: null },
        currency: 'PHP',
        completedAt: { gte: new Date(daily.from), lt: new Date(daily.to) },
      },
      _count: { _all: true },
      _sum: { totalPrice: true },
    });
    const dailyQuery = aggregate.mock.calls[0][0];
    await service.summary(actorId, shopId, daily.from, daily.to);
    expect(aggregate.mock.calls[1][0]).toEqual(dailyQuery);
  });
  it('reads only ten recent eligible completions with stable ordering and a minimal projection', async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { totalPrice: new Prisma.Decimal('0.10') },
    });
    groupBy.mockResolvedValue([
      {
        paymentMethod: 'CASH',
        _count: { _all: 1 },
        _sum: { totalPrice: new Prisma.Decimal('0.10') },
      },
    ]);
    const id = randomUUID();
    findMany.mockResolvedValue([
      {
        id,
        shopId,
        orderNumber: 'ORD-000042',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        currency: 'PHP',
        totalPrice: new Prisma.Decimal('0.10'),
        completedAt: new Date('2026-10-16T00:00:00.000Z'),
      },
    ]);
    const result = await service.daily(actorId, shopId, '2026-10-16');
    expect(result.recentOrders).toEqual([
      {
        id,
        shopId,
        orderNumber: 'ORD-000042',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        currency: 'PHP',
        totalPrice: '0.10',
        completedAt: '2026-10-16T00:00:00.000Z',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: aggregate.mock.calls[0][0].where,
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        shopId: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        preparationStatus: true,
        currency: true,
        totalPrice: true,
        completedAt: true,
      },
    });
  });
  it('returns zero for an empty day', async () => {
    expect(await service.daily(actorId, shopId, '2026-10-16')).toMatchObject({
      totalSales: '0.00',
      completedOrders: 0,
      itemsSold: 0,
    });
  });
  it('rejects access lost after the guard instead of displaying an empty report', async () => {
    findShop.mockResolvedValue(null);
    await expect(
      service.daily(actorId, shopId, '2026-10-16'),
    ).rejects.toMatchObject({
      response: { code: 'SHOP_NOT_ACCESSIBLE' },
      status: 404,
    });
    expect(aggregate).not.toHaveBeenCalled();
    expect(aggregateItems).not.toHaveBeenCalled();
    expect(groupBy).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(findShop).toHaveBeenCalledWith({
      where: {
        id: shopId,
        isActive: true,
        members: {
          some: {
            userId: actorId,
            disabledAt: null,
            role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
            user: { isActive: true },
          },
        },
      },
      select: { id: true },
    });
  });

  it('sums saved quantities with the same eligibility and a consistent snapshot', async () => {
    groupBy.mockResolvedValue([
      {
        paymentMethod: 'CASH',
        _count: { _all: 2 },
        _sum: { totalPrice: new Prisma.Decimal('10.00') },
      },
    ]);
    aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { totalPrice: new Prisma.Decimal('10.00') },
    });
    aggregateItems.mockResolvedValue({ _sum: { quantity: 17 } });
    expect(await service.daily(actorId, shopId, '2026-10-16')).toMatchObject({
      completedOrders: 2,
      totalSales: '10.00',
      itemsSold: 17,
    });
    expect(aggregateItems).toHaveBeenCalledWith({
      where: { shopId, order: aggregate.mock.calls[0][0].where },
      _sum: { quantity: true },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('groups methods with identical eligibility, fills missing methods and reconciles exact totals', async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _sum: { totalPrice: new Prisma.Decimal('0.30') },
    });
    groupBy.mockResolvedValue([
      {
        paymentMethod: 'GCASH_MANUAL',
        _count: { _all: 1 },
        _sum: { totalPrice: new Prisma.Decimal('0.20') },
      },
      {
        paymentMethod: 'CASH',
        _count: { _all: 2 },
        _sum: { totalPrice: new Prisma.Decimal('0.10') },
      },
      {
        paymentMethod: 'OTHER',
        _count: { _all: 1 },
        _sum: { totalPrice: new Prisma.Decimal('0.00') },
      },
    ]);
    const result = await service.daily(actorId, shopId, '2026-10-16');
    expect(result.paymentBreakdown).toEqual([
      { paymentMethod: 'CASH', orders: 2, totalSales: '0.10' },
      { paymentMethod: 'GCASH_MANUAL', orders: 1, totalSales: '0.20' },
      { paymentMethod: 'CARD_MANUAL', orders: 0, totalSales: '0.00' },
      { paymentMethod: 'OTHER', orders: 1, totalSales: '0.00' },
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['paymentMethod'],
      where: aggregate.mock.calls[0][0].where,
      _count: { _all: true },
      _sum: { totalPrice: true },
    });
  });
  it.each([null, 'UNKNOWN'])(
    'fails closed for unsupported saved payment method %s',
    async (paymentMethod) => {
      groupBy.mockResolvedValue([
        {
          paymentMethod,
          _count: { _all: 1 },
          _sum: { totalPrice: new Prisma.Decimal(1) },
        },
      ]);
      await expect(
        service.daily(actorId, shopId, '2026-10-16'),
      ).rejects.toThrow('Payment breakdown could not be calculated');
    },
  );
  it('fails closed when payment groups do not reconcile', async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { totalPrice: new Prisma.Decimal(1) },
    });
    await expect(service.daily(actorId, shopId, '2026-10-16')).rejects.toThrow(
      'does not match the sales summary',
    );
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed for an invalid item aggregate %s',
    async (quantity) => {
      aggregateItems.mockResolvedValue({ _sum: { quantity } });
      await expect(
        service.daily(actorId, shopId, '2026-10-16'),
      ).rejects.toThrow('Items sold could not be calculated');
    },
  );
});
