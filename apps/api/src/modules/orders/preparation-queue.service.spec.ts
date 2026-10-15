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
  it('pages completed history by completion time descending with ID tie breaking', async () => {
    const completedAt = new Date('2026-10-15T01:00:00.000Z');
    const rows = Array.from({ length: 51 }, () => ({
      ...row(),
      preparationStartedAt: new Date('2026-10-14T00:00:00.000Z'),
      preparationStartedBy: actorId,
      preparationReadyAt: new Date('2026-10-14T01:00:00.000Z'),
      preparationReadyBy: actorId,
      completedAt,
      completedBy: actorId,
    })).sort((a, b) => b.id.localeCompare(a.id));
    findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[50]]);
    const first = await service.list(actorId, shopId, undefined, 'COMPLETED');
    const second = await service.list(
      actorId,
      shopId,
      first.nextCursor!,
      'COMPLETED',
    );
    expect(
      new Set([...first.orders, ...second.orders].map((order) => order.id))
        .size,
    ).toBe(51);
    expect(findMany.mock.calls[1][0]).toMatchObject({
      where: {
        shopId,
        preparationStatus: 'COMPLETED',
        OR: [
          { completedAt: { lt: completedAt } },
          { completedAt, id: { lt: rows[49].id } },
        ],
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
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
  it('applies completed filters to the scoped database query with a bounded page', async () => {
    findMany.mockResolvedValue([]);
    await service.list(actorId, shopId, undefined, 'COMPLETED', {
      search: 'ord-000042',
      from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-16T00:00:00.000Z',
      limit: '12',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 13,
        where: expect.objectContaining({
          shopId,
          preparationStatus: 'COMPLETED',
          orderNumber: { contains: 'ORD-000042' },
          completedAt: {
            not: null,
            gte: new Date('2026-10-14T00:00:00.000Z'),
            lt: new Date('2026-10-16T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
  it.each([
    { search: ['ORD'] },
    { search: 'x'.repeat(33) },
    { search: '%' },
    { from: 'invalid' },
    { to: ['2026-10-15'] },
    { limit: '10000' },
    { from: '2026-10-16T00:00:00Z', to: '2026-10-15T00:00:00Z' },
  ])('rejects invalid history filters before querying: %j', async (filters) => {
    await expect(
      service.list(actorId, shopId, undefined, 'COMPLETED', filters),
    ).rejects.toMatchObject({ status: 400 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('returns only twelve history orders and builds the cursor from the last displayed row', async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      ...row(),
      preparationStartedAt: new Date('2026-10-14T00:00:00.000Z'),
      preparationStartedBy: actorId,
      preparationReadyAt: new Date('2026-10-14T01:00:00.000Z'),
      preparationReadyBy: actorId,
      completedAt: new Date(
        Date.parse('2026-10-15T02:00:00.000Z') - index * 1000,
      ),
      completedBy: actorId,
    }));
    findMany.mockResolvedValue(rows);
    const result = await service.list(actorId, shopId, undefined, 'COMPLETED', {
      limit: '12',
    });
    expect(result.orders.map((order) => order.id)).toEqual(
      rows.slice(0, 12).map((order) => order.id),
    );
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()),
    ).toEqual([rows[11].completedAt.toISOString(), rows[11].id]);
  });
});
