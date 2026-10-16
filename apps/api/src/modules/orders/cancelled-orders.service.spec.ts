import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { CancelledOrdersService } from './cancelled-orders.service.js';

describe('Owner cancelled / rejected orders', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const findMany = vi.fn(),
    requireOwner = vi.fn();
  const service = new CancelledOrdersService(
    { order: { findMany } } as unknown as PrismaService,
    { requireOwner } as unknown as ShopMembersService,
  );
  const row = () => ({
    id: randomUUID(),
    shopId,
    orderNumber: 'ORD-000042',
    mode: 'DINE_IN',
    tableNumber: 'Patio 2',
    status: 'REJECTED',
    paymentStatus: 'UNPAID',
    preparationStatus: null,
    currency: 'PHP',
    totalPrice: new Prisma.Decimal('1234567.89'),
    createdAt: new Date('2026-10-16T00:00:00.000Z'),
    decidedAt: new Date('2026-10-16T00:01:00.000Z'),
    decidedBy: randomUUID(),
    rejectionReason: 'Item unavailable',
  });
  beforeEach(() => {
    vi.resetAllMocks();
    findMany.mockResolvedValue([]);
  });

  it('isolates rejected history with live owner checks and stable placement/ID cursor pages', async () => {
    const rows = Array.from({ length: 26 }, row).sort((a, b) =>
      b.id.localeCompare(a.id),
    );
    findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[25]]);
    const first = await service.list(actorId, shopId);
    expect(first.orders).toHaveLength(25);
    expect(first.orders[0]).toMatchObject({
      totalPrice: '1234567.89',
      decidedBy: rows[0].decidedBy,
      rejectionReason: 'Item unavailable',
      decidedAt: rows[0].decidedAt.toISOString(),
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
        status: 'REJECTED',
        paymentStatus: 'UNPAID',
        preparationStatus: null,
        completedAt: null,
        currency: 'PHP',
        OR: [
          { createdAt: { lt: rows[24].createdAt } },
          { createdAt: rows[24].createdAt, id: { lt: rows[24].id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
    for (const field of [
      'items',
      'orderItems',
      'qrTokenNonce',
      'requestHash',
      'paymentReference',
      'paymentDescription',
    ]) {
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty(field);
    }
  });
  it('retains a captured actor ID independently of current membership and permits absent metadata', async () => {
    const record = row();
    findMany.mockResolvedValue([
      record,
      { ...row(), decidedAt: null, decidedBy: null, rejectionReason: null },
    ]);
    const { orders } = await service.list(actorId, shopId);
    expect(orders[0].decidedBy).toBe(record.decidedBy);
    expect(orders[1]).toMatchObject({
      decidedAt: null,
      decidedBy: null,
      rejectionReason: null,
    });
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('decidedBy');
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('decidedAt');
  });
  it('normalizes legacy blank metadata to null without inventing a reason or actor', async () => {
    findMany.mockResolvedValue([
      { ...row(), decidedBy: '  ', rejectionReason: '\n  ' },
    ]);
    expect((await service.list(actorId, shopId)).orders[0]).toMatchObject({
      decidedBy: null,
      rejectionReason: null,
    });
  });
  it('preserves multiline reasons and zero saved total without querying the live menu', async () => {
    findMany.mockResolvedValue([
      {
        ...row(),
        rejectionReason: 'Unavailable\nCustomer declined alternative',
        totalPrice: new Prisma.Decimal(0),
      },
    ]);
    expect((await service.list(actorId, shopId)).orders[0]).toMatchObject({
      rejectionReason: 'Unavailable\nCustomer declined alternative',
      totalPrice: '0.00',
    });
  });
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
  it('rechecks ownership before reading even an empty page', async () => {
    requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(service.list(actorId, shopId)).rejects.toMatchObject({
      status: 403,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each([
    { decidedAt: new Date('2026-10-15T00:00:00Z') },
    { rejectionReason: 'x'.repeat(301) },
  ])('fails closed for corrupt captured metadata: %j', async (patch) => {
    findMany.mockResolvedValue([{ ...row(), ...patch }]);
    await expect(service.list(actorId, shopId)).rejects.toMatchObject({
      status: 409,
    });
  });
});
