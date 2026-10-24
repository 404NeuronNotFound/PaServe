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
    ['Table 2', '2'],
    ['table #2', '2'],
    ['TABLE: Patio', 'Patio'],
    ['Table A%_\\', 'A\\%\\_\\\\'],
  ])(
    'recognizes a table prefix and keeps its label literal: %s',
    (search, label) => {
      expect(ownerOrderSearchWhere(search)?.OR).toEqual([
        {
          orderNumber: {
            contains: search.replace(/[\\%_]/g, '\\$&'),
            mode: 'insensitive',
          },
        },
        {
          tableNumber: {
            contains: search.replace(/[\\%_]/g, '\\$&'),
            mode: 'insensitive',
          },
        },
        { tableNumber: { contains: label, mode: 'insensitive' } },
      ]);
    },
  );
  it.each([
    ['dine - in', { mode: 'DINE_IN' }],
    ['DINE_IN', { mode: 'DINE_IN' }],
    ['take out', { mode: 'TAKEOUT' }],
    ['take', { mode: 'TAKEOUT' }],
    ['TAKE O', { mode: 'TAKEOUT' }],
    ['dine', { mode: 'DINE_IN' }],
    ['di', { mode: 'DINE_IN' }],
    ['takeaway', { mode: 'TAKEOUT' }],
    ['pickup', { mode: 'TAKEOUT' }],
    ['ready', { preparationStatus: 'READY' }],
    ['Ready to serve', { preparationStatus: 'READY' }],
    ['preparing', { preparationStatus: 'PREPARING' }],
    ['prep', { preparationStatus: 'PREPARING' }],
    ['prepare', { preparationStatus: 'PREPARING' }],
    ['read', { preparationStatus: 'READY' }],
    ['que', { preparationStatus: 'QUEUED' }],
    ['queued', { preparationStatus: 'QUEUED' }],
    ['queud', { preparationStatus: 'QUEUED' }],
    ['pending confirmation', { status: 'PENDING_CONFIRMATION' }],
    ['confirmed', { status: 'CONFIRMED' }],
    ['completed', { preparationStatus: 'COMPLETED' }],
    ['cancelled', { status: 'REJECTED' }],
    ['paid', { paymentStatus: 'PAID' }],
    ['unpaid', { paymentStatus: 'UNPAID' }],
  ])(
    'matches workflow terms while retaining literal label matches: %s',
    (search, predicate) => {
      const literal = search.replace(/[\\%_]/g, '\\$&');
      expect(ownerOrderSearchWhere(search)?.OR).toEqual([
        { orderNumber: { contains: literal, mode: 'insensitive' } },
        { tableNumber: { contains: literal, mode: 'insensitive' } },
        predicate,
      ]);
    },
  );
  it.each([
    'table',
    'table #',
    'constructor',
    '__proto__',
    't',
    '%',
    'take%',
    'taken',
  ])('does not broaden short, wildcard or unknown terms: %s', (search) => {
    expect(ownerOrderSearchWhere(search)?.OR).toHaveLength(2);
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
    it.each(['ready', 'dine - in', 'Table 2', 'take', 'prep'])(
      'keeps keyword search inside the shop and view: %s',
      async (search) => {
        await service.list(actorId, shopId, undefined, search);
        const { where, take } = findMany.mock.calls[0][0];
        expect(where.shopId).toBe(shopId);
        expect(where.shop.members.some.userId).toBe(actorId);
        expect(where.AND).toContainEqual(ownerOrderSearchWhere(search));
        if (view === 'completed') {
          expect(where.preparationStatus).toBe('COMPLETED');
          expect(where.paymentStatus).toBe('PAID');
        } else if (view === 'cancelled') expect(where.status).toBe('REJECTED');
        else expect(where.completedAt).toBeNull();
        expect(take).toBe(26);
      },
    );
  },
);
