import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { OwnerOrderDetailsService } from './owner-order-details.service.js';
import { CustomerOrderStatusService } from './customer-order-status.service.js';
import { PreparationQueueService } from './preparation-queue.service.js';
import { OrderTokenService } from './order-token.service.js';
import type { PreparationStatus } from '@paserve/contracts';

const actorId = randomUUID(),
  shopId = randomUUID(),
  orderId = randomUUID();
const time = (minute: number) => new Date(`2026-10-16T00:0${minute}:00.000Z`);
const row = () => ({
  id: orderId,
  shopId,
  orderNumber: 'ORD-000042',
  mode: 'DINE_IN',
  tableNumber: 'Patio 2',
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  preparationStatus: 'COMPLETED',
  currency: 'PHP',
  totalPrice: new Prisma.Decimal('36.00'),
  shopDetailsSnapshot: null,
  createdAt: time(0),
  updatedAt: time(5),
  decidedAt: time(1),
  decidedBy: actorId,
  rejectionReason: null,
  paymentMethod: 'CASH',
  paymentReference: null,
  paymentDescription: null,
  amountReceived: new Prisma.Decimal('50.00'),
  changeDue: new Prisma.Decimal('14.00'),
  paidAt: time(1),
  paidBy: actorId,
  queuedAt: time(1),
  preparationStartedAt: time(2),
  preparationStartedBy: actorId,
  preparationReadyAt: time(3),
  preparationReadyBy: actorId,
  completedAt: time(5),
  completedBy: actorId,
  orderItems: [
    {
      lineNumber: 1,
      productSnapshotId: 'coffee',
      productNameSnapshot: 'Original coffee',
      currency: 'PHP',
      quantity: 2,
      notes: 'Less ice',
      basePriceSnapshot: new Prisma.Decimal('10.00'),
      unitPriceSnapshot: new Prisma.Decimal('18.00'),
      lineTotalSnapshot: new Prisma.Decimal('36.00'),
      variantsSnapshot: [
        {
          id: 'large',
          name: 'Large',
          optionGroupId: 'size',
          isDefault: false,
          priceAdjustment: '5.00',
        },
      ],
      addOnsSnapshot: [
        { id: 'milk', name: 'Oat milk', priceAdjustment: '3.00' },
      ],
    },
  ],
});
describe('Owner order details', () => {
  const findFirst = vi.fn(),
    requireOwner = vi.fn();
  const service = new OwnerOrderDetailsService(
    { order: { findFirst } } as unknown as PrismaService,
    { requireOwner } as unknown as ShopMembersService,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    findFirst.mockResolvedValue(row());
  });

  it('uses the latest saved milestone when legacy application-clock updatedAt lags database time', async () => {
    const saved = row();
    saved.updatedAt = new Date(saved.completedAt.getTime() - 1227);
    findFirst.mockResolvedValue(saved);
    const result = await service.get(actorId, shopId, orderId);
    expect(result.order.updatedAt).toBe(saved.completedAt.toISOString());
    expect(result.order.completedAt).toBe(saved.completedAt.toISOString());
    expect(result.order.history.at(-1)?.at).toBe(
      saved.completedAt.toISOString(),
    );
  });

  it('retains a later saved updatedAt rather than replacing it with the last workflow event', async () => {
    const saved = row();
    saved.updatedAt = time(6);
    findFirst.mockResolvedValue(saved);
    expect((await service.get(actorId, shopId, orderId)).order.updatedAt).toBe(
      time(6).toISOString(),
    );
  });

  it('returns saved names, exact prices, modifiers, notes, payment and recorded history without secrets or live menu reads', async () => {
    const saved = {
      ...row(),
      qrToken: 'secret',
      qrTokenNonce: 'secret',
      items: 'legacy',
      paymentRequestId: 'secret',
      product: { name: 'Renamed' },
    };
    findFirst.mockResolvedValue(saved);
    const result = await service.get(actorId, shopId, orderId);
    expect(result.order).toMatchObject({
      totalPrice: '36.00',
      tableNumber: 'Patio 2',
      payment: { method: 'CASH', amountReceived: '50.00', changeDue: '14.00' },
      permittedActions: ['RECEIPT'],
      snapshotIssue: null,
    });
    expect(result.order.items?.[0]).toMatchObject({
      productName: 'Original coffee',
      quantity: 2,
      notes: 'Less ice',
      unitPrice: '18.00',
      variants: [{ name: 'Large' }],
      addOns: [{ name: 'Oat milk' }],
    });
    expect(result.order.history.map((event) => event.status)).toEqual([
      'PLACED',
      'CONFIRMED',
      'PAID',
      'QUEUED',
      'PREPARING',
      'READY',
      'COMPLETED',
    ]);
    expect(result.order.history[1].actorId).toBe(actorId);
    expect(JSON.stringify(result)).not.toMatch(/secret|Renamed|legacy|qrToken/);
    const args = findFirst.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: orderId, shopId });
    expect(JSON.stringify(args.where.shop)).toContain(actorId);
    expect(args.select.orderItems.where).toMatchObject({
      shopId,
      orderId,
      order: { shopId },
    });
    expect(args.select.orderItems.take).toBe(101);
    expect(args.select).not.toHaveProperty('items');
  });
  it.each([
    'missing-change',
    'wrong-net',
    'negative-change',
    'insufficient-tender',
  ])(
    'withholds inconsistent saved cash settlement (%s) like the customer receipt',
    async (kind) => {
      const saved = {
        ...row(),
        changeDue:
          kind === 'missing-change'
            ? null
            : new Prisma.Decimal(
                kind === 'negative-change' ? '-1.00' : '13.00',
              ),
      };
      if (kind === 'insufficient-tender')
        saved.amountReceived = new Prisma.Decimal('1.00');
      findFirst.mockResolvedValue(saved);
      expect((await service.get(actorId, shopId, orderId)).order).toMatchObject(
        {
          items: null,
          payment: null,
          permittedActions: [],
          snapshotIssue: expect.any(String),
        },
      );
    },
  );
  describe.each(['QUEUED', 'PREPARING', 'READY', 'COMPLETED'] as const)(
    'receipt/kitchen consistency at %s',
    (stage) => {
      it.each(['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])(
        'matches snapshot, totals, table, timestamps and %s payment across the actual read services',
        async (method) => {
          const saved = {
            ...row(),
            preparationStatus: stage,
            paymentMethod: method,
            paymentReference: method === 'CASH' ? null : 'TXN-0042',
            paymentDescription: method === 'OTHER' ? 'Gift voucher' : null,
            preparationStartedAt: stage === 'QUEUED' ? null : time(2),
            preparationStartedBy: stage === 'QUEUED' ? null : actorId,
            preparationReadyAt: ['READY', 'COMPLETED'].includes(stage)
              ? time(3)
              : null,
            preparationReadyBy: ['READY', 'COMPLETED'].includes(stage)
              ? actorId
              : null,
            completedAt: stage === 'COMPLETED' ? time(5) : null,
            completedBy: stage === 'COMPLETED' ? actorId : null,
            tableCode: 'saved-table-code',
            qrTokenExpiresAt: time(9),
            shopDetailsSnapshot: {
              name: 'Original cafe',
              address: 'Old street',
              phone: null,
              contactEmail: null,
              website: null,
            },
          };
          const database = {
            order: {
              findFirst: vi.fn().mockResolvedValue(saved),
              findMany: vi.fn().mockResolvedValue([saved]),
            },
            shop: {
              findFirst: vi.fn().mockResolvedValue({
                id: shopId,
                name: 'Renamed cafe',
                primaryColor: null,
                accentColor: null,
              }),
            },
          } as unknown as PrismaService;
          const owner = new OwnerOrderDetailsService(database, {
            requireOwner,
          } as unknown as ShopMembersService);
          const customer = new CustomerOrderStatusService(database, {
            resolveTrackingReference: () => ({ orderId }),
            verifyTracking: vi.fn(),
          } as unknown as OrderTokenService);
          const kitchen = new PreparationQueueService(database);
          const details = (await owner.get(actorId, shopId, orderId)).order;
          const tracking = await customer.read(
            'cafe',
            orderId,
            'test-credential',
          );
          const receipt = tracking.receipt!;
          const queue = (
            await kitchen.list(
              actorId,
              shopId,
              undefined,
              stage as PreparationStatus,
            )
          ).orders[0];
          expect(details.items).toEqual(receipt.items);
          expect(details.items).toEqual(queue.items);
          expect(details.payment).toEqual(receipt.payment);
          expect(details.shopDetails).toEqual(receipt.shopDetails);
          for (const field of [
            'id',
            'orderNumber',
            'mode',
            'currency',
            'totalPrice',
            'createdAt',
            'paidAt',
            'completedAt',
          ] as const)
            expect(details[field]).toEqual(receipt[field]);
          expect(details.tableNumber).toBe(receipt.table?.number);
          expect(details.status).toBe(tracking.order.status);
          expect(details.paymentStatus).toBe(tracking.order.paymentStatus);
          expect(details.preparationStatus).toBe(queue.preparationStatus);
          for (const field of [
            'id',
            'shopId',
            'orderNumber',
            'mode',
            'currency',
            'totalPrice',
            'tableNumber',
            'completedAt',
          ] as const)
            expect(details[field]).toEqual(queue[field]);
          const milestones = [
            ['QUEUED', 'queuedAt', null],
            ['PREPARING', 'preparationStartedAt', 'preparationStartedBy'],
            ['READY', 'preparationReadyAt', 'preparationReadyBy'],
            ['COMPLETED', 'completedAt', 'completedBy'],
          ] as const;
          for (const [status, timestamp, actor] of milestones) {
            const event = details.history.find(
              (entry) => entry.status === status,
            );
            if (queue[timestamp])
              expect(event).toEqual({
                status,
                at: queue[timestamp],
                actorId: actor ? queue[actor] : null,
              });
            else expect(event).toBeUndefined();
          }
        },
      );
    },
  );
  it.each([
    ['PENDING_CONFIRMATION', 'UNPAID', null, ['CASHIER']],
    ['CONFIRMED', 'UNPAID', null, ['CASHIER']],
    ['REJECTED', 'UNPAID', null, []],
    ['CONFIRMED', 'PAID', null, ['RECEIPT']],
    ['CONFIRMED', 'PAID', 'QUEUED', ['RECEIPT', 'START_PREPARING']],
    ['CONFIRMED', 'PAID', 'PREPARING', ['RECEIPT', 'MARK_READY']],
    ['CONFIRMED', 'PAID', 'READY', ['RECEIPT', 'COMPLETE']],
    ['CONFIRMED', 'PAID', 'COMPLETED', ['RECEIPT']],
  ])(
    'offers only state-appropriate actions for %s/%s/%s',
    async (status, paymentStatus, preparationStatus, actions) => {
      findFirst.mockResolvedValue({
        ...row(),
        status,
        paymentStatus,
        preparationStatus,
      });
      expect(
        (await service.get(actorId, shopId, orderId)).order.permittedActions,
      ).toEqual(actions);
    },
  );
  it('retains rejected audit data when legacy decision metadata and receipt lines are absent', async () => {
    const saved = {
      ...row(),
      status: 'REJECTED',
      paymentStatus: 'UNPAID',
      preparationStatus: null,
      decidedAt: null,
      decidedBy: null,
      paidAt: null,
      queuedAt: null,
      preparationStartedAt: null,
      preparationReadyAt: null,
      completedAt: null,
      rejectionReason: 'Out of stock',
      orderItems: [],
    };
    findFirst.mockResolvedValue(saved);
    const { order } = await service.get(actorId, shopId, orderId);
    expect(order).toMatchObject({
      rejectionReason: 'Out of stock',
      items: null,
      payment: null,
      permittedActions: [],
    });
    expect(order.snapshotIssue).toBeTruthy();
    expect(order.history).toEqual([
      { status: 'PLACED', at: time(0).toISOString(), actorId: null },
    ]);
  });
  it.each(['sum', 'sequence', 'arithmetic', 'identity', 'shop'])(
    'withholds actions and receipt for corrupt %s snapshots',
    async (kind) => {
      const saved = row();
      if (kind === 'sum') saved.totalPrice = new Prisma.Decimal('99.00');
      if (kind === 'sequence') saved.orderItems[0].lineNumber = 2;
      if (kind === 'arithmetic')
        saved.orderItems[0].unitPriceSnapshot = new Prisma.Decimal('0.00');
      if (kind === 'identity') saved.orderItems[0].productNameSnapshot = '';
      findFirst.mockResolvedValue(
        kind === 'shop'
          ? { ...saved, shopDetailsSnapshot: { name: '' } }
          : saved,
      );
      expect((await service.get(actorId, shopId, orderId)).order).toMatchObject(
        { items: null, permittedActions: [] },
      );
    },
  );
  it('redacts unsafe payment reference text', async () => {
    findFirst.mockResolvedValue({
      ...row(),
      paymentMethod: 'CARD_MANUAL',
      paymentReference: '4111 1111 1111 1111',
    });
    expect(
      (await service.get(actorId, shopId, orderId)).order.payment?.reference,
    ).toBeNull();
  });
  it('does not query orders after live owner access is revoked', async () => {
    requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(service.get(actorId, shopId, orderId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('returns the same unavailable response for missing or foreign orders', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.get(actorId, shopId, orderId)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_ACCESSIBLE' },
    });
  });
  it('rejects malformed resource IDs before querying', async () => {
    await expect(service.get(actorId, shopId, 'invalid')).rejects.toMatchObject(
      { response: { code: 'INVALID_ORDER_ID' } },
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});
