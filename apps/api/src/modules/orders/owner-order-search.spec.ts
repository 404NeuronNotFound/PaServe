import { randomUUID } from 'node:crypto';
import { normalizeOwnerOrderSearch } from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ownerOrderSearchWhere } from './owner-order-search.js';
import { ActiveOrdersService } from './active-orders.service.js';
import { CompletedOrdersService } from './completed-orders.service.js';
import { CancelledOrdersService } from './cancelled-orders.service.js';

describe('Safe owner order search', () => {
  it.each([undefined, '', '   '])(
    'treats missing/blank text as unfiltered: %s',
    (value) => {
      expect(normalizeOwnerOrderSearch(value)).toBe('');
      expect(ownerOrderSearchWhere(value)).toBeUndefined();
    },
  );
  it.each(['  ord-000042  ', 'Patio 2', "Chef's table", '桌 2', 'Café'])(
    'searches only order number and saved table label: %s',
    (value) => {
      expect(ownerOrderSearchWhere(value)).toEqual({
        OR: [
          { orderNumber: { contains: value.trim(), mode: 'insensitive' } },
          { tableNumber: { contains: value.trim(), mode: 'insensitive' } },
        ],
      });
    },
  );
  it('escapes SQL LIKE wildcards instead of treating them as match-all patterns', () => {
    expect(ownerOrderSearchWhere('%_\\')).toEqual({
      OR: [
        { orderNumber: { contains: '\\%\\_\\\\', mode: 'insensitive' } },
        { tableNumber: { contains: '\\%\\_\\\\', mode: 'insensitive' } },
      ],
    });
  });
  it.each([
    null,
    ['ORD'],
    {},
    42,
    'x'.repeat(81),
    'Patio\n2',
    '\u0000',
    '\u007f',
  ])('rejects malformed search: %j', (value) => {
    expect(normalizeOwnerOrderSearch(value)).toBeNull();
    expect(() => ownerOrderSearchWhere(value)).toThrow();
  });
});

describe.each([
  ['active', ActiveOrdersService],
  ['completed', CompletedOrdersService],
  ['cancelled', CancelledOrdersService],
] as const)(
  '%s search composes with tenant, state and pagination',
  (view, Service) => {
    const actorId = randomUUID(),
      shopId = randomUUID(),
      orderId = randomUUID();
    const findMany = vi.fn(),
      requireOwner = vi.fn();
    const service = new Service(
      { order: { findMany } } as unknown as PrismaService,
      { requireOwner } as unknown as ShopMembersService,
    );
    beforeEach(() => {
      vi.resetAllMocks();
      findMany.mockResolvedValue([]);
    });
    it('filters the whole server query while preserving cursor and state boundaries', async () => {
      const at = '2026-10-16T00:00:00.000Z';
      const cursor = Buffer.from(JSON.stringify([at, orderId])).toString(
        'base64url',
      );
      await service.list(actorId, shopId, cursor, '  pAtIo  ');
      expect(requireOwner).toHaveBeenCalledWith(actorId, shopId);
      const query = findMany.mock.calls[0][0];
      expect(query.where).toMatchObject({
        shopId,
        shop: {
          id: shopId,
          isActive: true,
          members: { some: { userId: actorId, role: 'OWNER' } },
        },
        status:
          view === 'active'
            ? { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] }
            : view === 'completed'
              ? 'CONFIRMED'
              : 'REJECTED',
      });
      expect(query.where.AND).toEqual(
        expect.arrayContaining([ownerOrderSearchWhere('pAtIo')]),
      );
      const field = view === 'completed' ? 'completedAt' : 'createdAt';
      const direction = view === 'active' ? 'gt' : 'lt';
      const page = {
        OR: [
          { [field]: { [direction]: new Date(at) } },
          { [field]: new Date(at), id: { [direction]: orderId } },
        ],
      };
      if (view === 'active')
        expect(query.where.AND).toEqual(expect.arrayContaining([page]));
      else expect(query.where.OR).toEqual(page.OR);
      expect(query.take).toBe(26);
    });
    it('rejects arrays before querying, instead of broadening the search', async () => {
      await expect(
        service.list(actorId, shopId, undefined, ['ORD', 'table']),
      ).rejects.toMatchObject({ status: 400 });
      expect(findMany).not.toHaveBeenCalled();
    });
  },
);
