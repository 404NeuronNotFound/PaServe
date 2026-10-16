import { randomUUID } from 'node:crypto';
import {
  normalizeOwnerOrderFilters,
  ownerOrderDateBounds,
  type OwnerOrderView,
} from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { ownerOrderFiltersWhere } from './owner-order-filters.js';
import { ownerOrderSearchWhere } from './owner-order-search.js';
import { ActiveOrdersService } from './active-orders.service.js';
import { CompletedOrdersService } from './completed-orders.service.js';
import { CancelledOrdersService } from './cancelled-orders.service.js';

describe('Owner order filter validation and dates', () => {
  it('normalizes blank selections and preserves printable exact table labels', () => {
    expect(
      normalizeOwnerOrderFilters({ mode: '', table: '   ' }, 'active'),
    ).toEqual({});
    expect(
      normalizeOwnerOrderFilters({ table: '  Patio %_  ' }, 'active'),
    ).toEqual({ table: 'Patio %_' });
    expect(ownerOrderFiltersWhere({ table: 'Patio %_' }, 'active')).toEqual({
      AND: [
        {
          mode: 'DINE_IN',
          tableNumber: { equals: 'Patio \\%\\_', mode: 'insensitive' },
        },
      ],
    });
  });
  it('converts an inclusive Manila day to an inclusive/exclusive UTC range', () => {
    expect(
      ownerOrderDateBounds({ from: '2026-10-16', to: '2026-10-16' }),
    ).toEqual({
      gte: '2026-10-15T16:00:00.000Z',
      lt: '2026-10-16T16:00:00.000Z',
    });
    expect(ownerOrderDateBounds({ to: '2024-02-29' })).toEqual({
      lt: '2024-02-29T16:00:00.000Z',
    });
    expect(ownerOrderDateBounds({ from: '2026-01-01' })).toEqual({
      gte: '2025-12-31T16:00:00.000Z',
    });
  });
  it.each([
    null,
    [],
    { mode: ['DINE_IN', 'TAKEOUT'] },
    { status: 'COMPLETED' },
    { mode: 'DELIVERY' },
    { paymentMethod: 'STRIPE' },
    { table: 'x'.repeat(41) },
    { table: 'Patio\n2' },
    { table: 'Patio', mode: 'TAKEOUT' },
    { from: '2026-02-30' },
    { from: '2026-02-29' },
    { from: '2026-1-1' },
    { from: '2026-10-16T00:00:00Z' },
    { from: '2026-10-17', to: '2026-10-16' },
    { from: ['2026-10-16'] },
    { shopId: randomUUID() },
    { paymentStatus: 'PAID' },
  ])('rejects invalid or forged active filters: %j', (filters) => {
    expect(normalizeOwnerOrderFilters(filters, 'active')).toBeNull();
    expect(() => ownerOrderFiltersWhere(filters, 'active')).toThrow();
  });
  it.each<[OwnerOrderView, object]>([
    ['completed', { status: 'READY' }],
    ['completed', { paymentMethod: 'UNRECORDED' }],
    ['cancelled', { status: 'CONFIRMED' }],
    ['cancelled', { status: 'CANCELLED' }],
    ['cancelled', { paymentMethod: 'CASH' }],
  ])('rejects filters that cannot belong in %s: %j', (view, filters) => {
    expect(() => ownerOrderFiltersWhere(filters, view)).toThrow();
  });
  it.each([
    ['PENDING_CONFIRMATION', { status: 'PENDING_CONFIRMATION' }],
    ['CONFIRMED', { status: 'CONFIRMED' }],
    [
      'AWAITING_PAYMENT',
      { status: 'CONFIRMED', paymentStatus: 'UNPAID', preparationStatus: null },
    ],
    [
      'AWAITING_PREPARATION',
      { status: 'CONFIRMED', paymentStatus: 'PAID', preparationStatus: null },
    ],
    [
      'QUEUED',
      {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'QUEUED',
      },
    ],
    [
      'PREPARING',
      {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'PREPARING',
      },
    ],
    [
      'READY',
      {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'READY',
      },
    ],
  ])(
    'maps the %s operational status without merging approval/payment/preparation',
    (status, where) => {
      expect(ownerOrderFiltersWhere({ status }, 'active')).toEqual({
        AND: [where],
      });
    },
  );
  it('supports unrecorded payment as null and keeps paid methods exact', () => {
    expect(
      ownerOrderFiltersWhere({ paymentMethod: 'UNRECORDED' }, 'active'),
    ).toEqual({ AND: [{ paymentMethod: null }] });
    for (const paymentMethod of [
      'CASH',
      'GCASH_MANUAL',
      'CARD_MANUAL',
      'OTHER',
    ]) {
      expect(ownerOrderFiltersWhere({ paymentMethod }, 'completed')).toEqual({
        AND: [{ paymentMethod }],
      });
    }
  });
});

describe.each([
  ['active', ActiveOrdersService],
  ['completed', CompletedOrdersService],
  ['cancelled', CancelledOrdersService],
] as const)('%s filter composition', (view, Service) => {
  const actorId = randomUUID(),
    shopId = randomUUID(),
    id = randomUUID();
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
  it('ANDs filters with search, tenant, lifecycle and cursor before applying the page limit', async () => {
    const at = '2026-10-16T00:00:00.000Z';
    const cursor = Buffer.from(JSON.stringify([at, id])).toString('base64url');
    const filters = {
      mode: 'DINE_IN',
      table: 'Patio',
      from: '2026-10-16',
      to: '2026-10-16',
    };
    await service.list(actorId, shopId, cursor, 'ORD', filters);
    expect(requireOwner).toHaveBeenCalledWith(actorId, shopId);
    const query = findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      shopId,
      shop: {
        id: shopId,
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
      expect.arrayContaining([
        ownerOrderSearchWhere('ORD'),
        ownerOrderFiltersWhere(filters, view),
      ]),
    );
    const field = view === 'completed' ? 'completedAt' : 'createdAt';
    expect(ownerOrderFiltersWhere(filters, view)).toMatchObject({
      AND: expect.arrayContaining([
        {
          [field]: {
            gte: new Date('2026-10-15T16:00:00Z'),
            lt: new Date('2026-10-16T16:00:00Z'),
          },
        },
      ]),
    });
    const direction = view === 'active' ? 'gt' : 'lt';
    const page = {
      OR: [
        { [field]: { [direction]: new Date(at) } },
        { [field]: new Date(at), id: { [direction]: id } },
      ],
    };
    if (view === 'active')
      expect(query.where.AND).toEqual(expect.arrayContaining([page]));
    else expect(query.where.OR).toEqual(page.OR);
    expect(query.take).toBe(26);
  });
  it('rejects duplicate filter arrays without querying', async () => {
    await expect(
      service.list(actorId, shopId, undefined, undefined, {
        mode: ['DINE_IN', 'TAKEOUT'],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
