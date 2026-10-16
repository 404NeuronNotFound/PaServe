import { randomUUID } from 'node:crypto';
import { salesBusinessDate, salesBusinessDayBounds } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CompletedSalesService } from './completed-sales.service.js';

describe('Daily gross sales', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const aggregate = vi.fn();
  const service = new CompletedSalesService({
    order: { aggregate },
  } as unknown as PrismaService);
  beforeEach(() => {
    vi.resetAllMocks();
    aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { totalPrice: null },
    });
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
  it('returns zero for an empty day', async () => {
    expect(await service.daily(actorId, shopId, '2026-10-16')).toMatchObject({
      totalSales: '0.00',
      completedOrders: 0,
    });
  });
});
