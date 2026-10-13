import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PreparationQueueService } from './preparation-queue.service.js';

describe('Preparation queue pages', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const findMany = vi.fn();
  const service = new PreparationQueueService({
    order: { findMany },
  } as unknown as PrismaService);
  function row() {
    return {
      id: randomUUID(),
      shopId,
      orderNumber: 'ORD-000042',
      mode: 'TAKEOUT',
      tableNumber: null,
      currency: 'PHP',
      totalPrice: new Prisma.Decimal('10.00'),
      queuedAt: new Date('2026-10-13T00:00:00.000Z'),
      orderItems: [
        {
          lineNumber: 1,
          productSnapshotId: randomUUID(),
          productNameSnapshot: 'Coffee',
          currency: 'PHP',
          quantity: 1,
          notes: null,
          basePriceSnapshot: new Prisma.Decimal(10),
          unitPriceSnapshot: new Prisma.Decimal(10),
          lineTotalSnapshot: new Prisma.Decimal(10),
          variantsSnapshot: [],
          addOnsSnapshot: [],
        },
      ],
    };
  }
  beforeEach(() => vi.resetAllMocks());
  it('returns bounded FIFO pages with a tie-breaking cursor and scoped live access', async () => {
    const rows = Array.from({ length: 51 }, row).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[50]]);
    const first = await service.list(actorId, shopId);
    expect(first.orders).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const next = await service.list(actorId, shopId, first.nextCursor!);
    expect(next.orders.map((order) => order.id)).toEqual([rows[50].id]);
    expect(next.nextCursor).toBeNull();
    expect(findMany.mock.calls[1][0]).toMatchObject({
      where: {
        shopId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'QUEUED',
        shop: {
          id: shopId,
          isActive: true,
          members: { some: { userId: actorId, user: { isActive: true } } },
        },
        OR: [
          { queuedAt: { gt: rows[49].queuedAt } },
          { queuedAt: rows[49].queuedAt, id: { gt: rows[49].id } },
        ],
      },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: 51,
    });
  });
  it.each([
    '',
    '!',
    'invalid',
    Buffer.from(JSON.stringify(['bad-date', randomUUID()])).toString(
      'base64url',
    ),
  ])('rejects invalid cursors before a query: %s', async (cursor) => {
    await expect(service.list(actorId, shopId, cursor)).rejects.toMatchObject({
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('does not return a receipt whose line totals disagree with its order', async () => {
    findMany.mockResolvedValue([
      { ...row(), totalPrice: new Prisma.Decimal(11) },
    ]);
    await expect(service.list(actorId, shopId)).rejects.toMatchObject({
      status: 409,
    });
  });
  it.each([
    'line-gap',
    'corrupt-options',
    'inconsistent-unit',
    'empty',
    'too-many',
  ])(
    'rejects corrupt queue snapshots with a controlled conflict: %s',
    async (kind) => {
      const order = row();
      if (kind === 'line-gap') order.orderItems[0].lineNumber = 2;
      if (kind === 'corrupt-options')
        order.orderItems[0].variantsSnapshot = null as never;
      if (kind === 'inconsistent-unit')
        order.orderItems[0].unitPriceSnapshot = new Prisma.Decimal(9);
      if (kind === 'empty') order.orderItems = [];
      if (kind === 'too-many')
        order.orderItems = Array.from({ length: 101 }, (_, index) => ({
          ...row().orderItems[0],
          lineNumber: index + 1,
        }));
      findMany.mockResolvedValue([order]);
      await expect(service.list(actorId, shopId)).rejects.toMatchObject({
        status: 409,
      });
    },
  );
});
