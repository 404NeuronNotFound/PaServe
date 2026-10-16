import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { CompletedOrdersService } from './completed-orders.service.js';

describe('Owner completed orders', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const findMany = vi.fn(),
    requireOwner = vi.fn();
  const service = new CompletedOrdersService(
    { order: { findMany } } as unknown as PrismaService,
    { requireOwner } as unknown as ShopMembersService,
  );
  const row = () => ({
    id: randomUUID(),
    shopId,
    orderNumber: 'ORD-000042',
    mode: 'DINE_IN',
    tableNumber: 'Patio 2',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    preparationStatus: 'COMPLETED',
    paymentMethod: 'CASH',
    currency: 'PHP',
    totalPrice: new Prisma.Decimal('1234567.89'),
    createdAt: new Date('2026-10-16T00:00:00.000Z'),
    paidAt: new Date('2026-10-16T00:01:00.000Z'),
    completedAt: new Date('2026-10-16T00:05:00.000Z'),
  });
  beforeEach(() => {
    vi.resetAllMocks();
    findMany.mockResolvedValue([]);
  });

  it('uses reporting eligibility, live owner scope and descending completion/ID pagination', async () => {
    const rows = Array.from({ length: 26 }, row).sort((a, b) =>
      b.id.localeCompare(a.id),
    );
    findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[25]]);
    const first = await service.list(actorId, shopId);
    expect(first.orders).toHaveLength(25);
    expect(first.orders[0]).toMatchObject({
      totalPrice: '1234567.89',
      tableNumber: 'Patio 2',
      completedAt: rows[0].completedAt.toISOString(),
      paidAt: rows[0].paidAt.toISOString(),
    });
    const second = await service.list(actorId, shopId, first.nextCursor);
    expect(
      new Set([...first.orders, ...second.orders].map((o) => o.id)).size,
    ).toBe(26);
    expect(second.nextCursor).toBeNull();
    expect(requireOwner).toHaveBeenCalledWith(actorId, shopId);
    expect(findMany.mock.calls[1][0]).toMatchObject({
      where: {
        shopId,
        shop: {
          id: shopId,
          isActive: true,
          members: {
            some: { userId: actorId, role: 'OWNER', user: { isActive: true } },
          },
        },
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        completedAt: { not: null },
        completedBy: { not: null },
        currency: 'PHP',
        OR: [
          { completedAt: { lt: rows[24].completedAt } },
          { completedAt: rows[24].completedAt, id: { lt: rows[24].id } },
        ],
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
    expect(Object.keys(findMany.mock.calls[0][0].select)).toEqual(
      expect.arrayContaining(['completedAt', 'paymentMethod', 'totalPrice']),
    );
    for (const field of [
      'items',
      'orderItems',
      'qrTokenNonce',
      'requestHash',
      'paymentReference',
      'paymentDescription',
      'completedBy',
    ]) {
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty(field);
    }
  });
  it('sorts/paginates by fulfillment time rather than placement time', async () => {
    const order = { ...row(), createdAt: new Date('2026-01-01T00:00:00Z') };
    findMany.mockResolvedValue(
      Array.from({ length: 26 }, () => ({ ...order, id: randomUUID() })),
    );
    const result = await service.list(actorId, shopId);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()),
    ).toEqual([order.completedAt.toISOString(), expect.any(String)]);
  });
  it.each(['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])(
    'keeps saved %s payment and zero total without repricing menu items',
    async (paymentMethod) => {
      findMany.mockResolvedValue([
        { ...row(), paymentMethod, totalPrice: new Prisma.Decimal(0) },
      ]);
      expect((await service.list(actorId, shopId)).orders[0]).toMatchObject({
        paymentMethod,
        totalPrice: '0.00',
      });
    },
  );
  it.each([
    '',
    '!',
    'invalid',
    ['duplicate'],
    Buffer.from(JSON.stringify(['bad-date', randomUUID()])).toString(
      'base64url',
    ),
  ])('rejects invalid cursors: %s', async (cursor) => {
    await expect(service.list(actorId, shopId, cursor)).rejects.toMatchObject({
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rejects missing tenant context', async () => {
    await expect(service.list(actorId, '')).rejects.toMatchObject({
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rechecks ownership before reading history even on an empty page', async () => {
    requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(service.list(actorId, shopId)).rejects.toMatchObject({
      status: 403,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each([
    { completedAt: null },
    { paidAt: null },
    { paymentMethod: 'bad' },
    { completedAt: new Date('2026-10-15T00:00:00Z') },
    { paidAt: new Date('2026-01-01T00:00:00Z') },
  ])(
    'fails closed for unavailable historical payment/timing: %j',
    async (patch) => {
      findMany.mockResolvedValue([{ ...row(), ...patch }]);
      await expect(service.list(actorId, shopId)).rejects.toMatchObject({
        status: 409,
      });
    },
  );
});
