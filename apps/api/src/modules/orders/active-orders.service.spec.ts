import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ActiveOrdersService } from './active-orders.service.js';

describe('Owner active orders', () => {
  const actorId = randomUUID(),
    shopId = randomUUID();
  const findMany = vi.fn(),
    requireOwner = vi.fn();
  const service = new ActiveOrdersService(
    { order: { findMany } } as unknown as PrismaService,
    { requireOwner } as unknown as ShopMembersService,
  );
  const row = () => ({
    id: randomUUID(),
    shopId,
    orderNumber: 'ORD-000042',
    mode: 'DINE_IN',
    tableNumber: 'Patio 2',
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    preparationStatus: null,
    currency: 'PHP',
    totalPrice: new Prisma.Decimal('1234567.89'),
    createdAt: new Date('2026-10-16T00:00:00.000Z'),
    updatedAt: new Date('2026-10-16T00:00:00.000Z'),
  });
  beforeEach(() => {
    vi.resetAllMocks();
    findMany.mockResolvedValue([]);
  });

  it('jumps directly to the last numbered page using matching scoped counts and a fixed cutoff', async () => {
    const snapshot = '2026-10-17T00:00:00.000Z';
    const count = vi.fn().mockResolvedValue(37);
    const findFirst = vi.fn().mockResolvedValue({ id: 'new-order' });
    const tx = { order: { count, findMany, findFirst } };
    const transaction = vi.fn(
      async (read: (db: typeof tx) => Promise<unknown>) => read(tx),
    );
    const pagedService = new ActiveOrdersService(
      { ...tx, $transaction: transaction } as unknown as PrismaService,
      { requireOwner } as unknown as ShopMembersService,
    );
    findMany.mockResolvedValue([row()]);
    const result = await pagedService.list(
      actorId,
      shopId,
      undefined,
      '000042',
      {},
      { page: '99', snapshot },
    );
    expect(result.pagination).toEqual({
      page: 4,
      pageCount: 4,
      pageSize: 12,
      total: 37,
      snapshot,
      hasNew: true,
    });
    expect(result.nextCursor).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 36, take: 12 }),
    );
    const predicate = count.mock.calls[0][0].where;
    expect(predicate.AND[0]).toMatchObject({
      shopId,
      shop: { id: shopId, isActive: true },
    });
    expect(findMany.mock.calls[0][0].where).toEqual(predicate);
    expect(JSON.stringify(predicate)).toContain(snapshot);
    expect(JSON.stringify(predicate)).toContain('000042');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('uses bounded oldest-first pages, immutable time/ID cursors, and live owner/shop predicates', async () => {
    const rows = Array.from({ length: 26 }, row).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[25]]);
    const first = await service.list(actorId, shopId);
    expect(first.orders).toHaveLength(25);
    expect(first.orders[0]).toMatchObject({
      totalPrice: '1234567.89',
      tableNumber: 'Patio 2',
      createdAt: rows[0].createdAt.toISOString(),
    });
    expect(requireOwner).toHaveBeenCalledWith(actorId, shopId);
    const next = await service.list(actorId, shopId, first.nextCursor);
    expect(next.orders.map((o) => o.id)).toEqual([rows[25].id]);
    expect(next.nextCursor).toBeNull();
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
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
        completedAt: null,
        AND: [
          {
            OR: [
              { preparationStatus: null },
              { preparationStatus: { in: ['QUEUED', 'PREPARING', 'READY'] } },
            ],
          },
          {
            OR: [
              { createdAt: { gt: rows[24].createdAt } },
              { createdAt: rows[24].createdAt, id: { gt: rows[24].id } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 26,
    });
    expect(Object.keys(findMany.mock.calls[0][0].select)).not.toContain(
      'qrTokenNonce',
    );
    expect(Object.keys(findMany.mock.calls[0][0].select)).not.toContain(
      'paymentReference',
    );
  });

  it('rejects revoked ownership before querying even an empty page', async () => {
    requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(service.list(actorId, shopId)).rejects.toMatchObject({
      status: 403,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '!',
    'invalid',
    ['duplicate'],
    Buffer.from(JSON.stringify(['bad-date', randomUUID()])).toString(
      'base64url',
    ),
  ])('rejects malformed cursors before querying: %s', async (cursor) => {
    await expect(service.list(actorId, shopId, cursor)).rejects.toMatchObject({
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed tenant context instead of omitting database predicates', async () => {
    await expect(service.list(actorId, '')).rejects.toMatchObject({
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
