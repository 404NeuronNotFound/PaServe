import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service.js';
import { OrderTokenService } from './order-token.service.js';
import { CustomerOrderStatusService } from './customer-order-status.service.js';

describe('Customer receipt status access', () => {
  const tokens = new OrderTokenService(
    new ConfigService({
      JWT_ACCESS_SECRET: 'test-only-order-secret-at-least-32-characters',
    }),
  );
  const id = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const database = {
    shop: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
  };
  const service = new CustomerOrderStatusService(
    database as unknown as PrismaService,
    tokens,
  );
  let order: ReturnType<typeof fixture>;
  const fixture = () => ({
    id,
    shopDetailsSnapshot: null as unknown,
    shopId,
    orderNumber: 'ORD-000042',
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    mode: 'TAKEOUT',
    totalPrice: { toFixed: () => '12.00' },
    tableCode: null,
    tableNumber: null,
    ...tokens.metadata(),
    qrTokenRevokedAt: null as Date | null,
    receiptAccessRevokedAt: null as Date | null,
    decidedAt: null as Date | null,
    updatedAt: new Date(),
    preparationStatus: null as string | null,
    preparationStartedAt: null as Date | null,
    preparationReadyAt: null as Date | null,
    completedAt: null as Date | null,
    queuedAt: null as Date | null,
    paidBy: 'private-actor',
    paymentReference: 'private-reference',
  });
  beforeEach(() => {
    vi.clearAllMocks();
    order = fixture();
    database.shop.findFirst.mockResolvedValue({
      id: shopId,
      name: 'Cafe',
      primaryColor: null,
      accentColor: null,
    });
    database.order.findFirst.mockImplementation(async () => order);
  });

  it('reopens the original shop identity after current settings change', async () => {
    const details = {
      name: 'Original Cafe', address: '12 Old Street', phone: '09171234567',
      contactEmail: 'hello@example.com', website: 'https://example.com',
    };
    order.shopDetailsSnapshot = { ...details, privateField: 'must not escape' };
    database.shop.findFirst.mockResolvedValue({ id: shopId, name: 'Renamed Cafe' });
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(result.receipt?.shopName).toBe(details.name);
    expect(result.receipt?.shopDetails).toEqual(details);
  });

  it('does not invent contact details for legacy orders', async () => {
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(result.receipt?.shopDetails).toBeNull();
    expect(result.receipt?.shopName).toBe('Cafe');
  });

  it('reads only the credential-bound order under its resolved shop', async () => {
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(database.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, shopId, shop: { id: shopId, isActive: true } },
      }),
    );
    expect(result.order.status).toBe('PENDING_CONFIRMATION');
    expect(Object.keys(result.order).sort()).toEqual([
      'completedAt',
      'confirmedAt',
      'id',
      'orderNumber',
      'paymentStatus',
      'preparationReadyAt',
      'preparationStartedAt',
      'preparationStatus',
      'shopId',
      'status',
      'updatedAt',
    ]);
  });
  it('allows read-only receipt access after scan consumption while staff verification stays revoked', async () => {
    const token = tokens.issueTracking(order);
    order.status = 'CONFIRMED';
    order.paymentStatus = 'PAID';
    order.decidedAt = new Date();
    order.qrTokenRevokedAt = order.decidedAt;
    expect(() => tokens.verify(token, order)).toThrow();
    const result = await service.read('cafe', id, token);
    expect(result.order).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      confirmedAt: order.decidedAt.toISOString(),
    });
  });
  it('returns saved preparation status and time without exposing the preparation actor', async () => {
    order.status = 'CONFIRMED';
    order.paymentStatus = 'PAID';
    order.decidedAt = new Date();
    order.preparationStatus = 'PREPARING';
    order.queuedAt = order.decidedAt;
    order.preparationStartedAt = new Date(order.decidedAt.getTime() + 1000);
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(result.order).toMatchObject({
      preparationStatus: 'PREPARING',
      preparationStartedAt: order.preparationStartedAt.toISOString(),
    });
    expect(result.order).not.toHaveProperty('preparationStartedBy');
    order.preparationStartedAt = null;
    await expect(
      service.read('cafe', id, tokens.issueTracking(order)),
    ).rejects.toMatchObject({ response: { code: 'INVALID_ORDER_STATE' } });
  });
  it('returns saved readiness and rejects an invalid readiness timeline', async () => {
    order.status = 'CONFIRMED';
    order.paymentStatus = 'PAID';
    order.decidedAt = new Date();
    order.queuedAt = order.decidedAt;
    order.preparationStatus = 'READY';
    order.preparationStartedAt = new Date(order.decidedAt.getTime() + 1000);
    order.preparationReadyAt = new Date(order.decidedAt.getTime() + 2000);
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(result.order).toMatchObject({
      preparationStatus: 'READY',
      preparationReadyAt: order.preparationReadyAt.toISOString(),
    });
    expect(result.order).not.toHaveProperty('preparationReadyBy');
    order.preparationReadyAt = order.decidedAt;
    await expect(
      service.read('cafe', id, tokens.issueTracking(order)),
    ).rejects.toMatchObject({ response: { code: 'INVALID_ORDER_STATE' } });
  });
  it('returns saved completion and rejects missing or out-of-order completion time', async () => {
    order.status = 'CONFIRMED';
    order.paymentStatus = 'PAID';
    order.decidedAt = new Date();
    order.queuedAt = order.decidedAt;
    order.preparationStatus = 'COMPLETED';
    order.preparationStartedAt = new Date(order.decidedAt.getTime() + 1000);
    order.preparationReadyAt = new Date(order.decidedAt.getTime() + 2000);
    order.completedAt = new Date(order.decidedAt.getTime() + 3000);
    const result = await service.read('cafe', id, tokens.issueTracking(order));
    expect(result.order).toMatchObject({
      preparationStatus: 'COMPLETED',
      completedAt: order.completedAt.toISOString(),
    });
    expect(result.order).not.toHaveProperty('completedBy');
    for (const invalid of [null, order.decidedAt]) {
      order.completedAt = invalid;
      await expect(
        service.read('cafe', id, tokens.issueTracking(order)),
      ).rejects.toMatchObject({ response: { code: 'INVALID_ORDER_STATE' } });
    }
  });
  it.each([
    'wrong-order',
    'wrong-shop',
    'tampered',
    'expired',
    'receipt-revoked',
  ])('rejects %s credentials', async (kind) => {
    const token = tokens.issueTracking(order);
    let target = id,
      credential = token;
    if (kind === 'wrong-order') target = '75992537-5d60-4d22-8e1e-60a114644681';
    if (kind === 'wrong-shop')
      database.shop.findFirst.mockResolvedValue({
        id: '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24',
      });
    if (kind === 'tampered') credential += 'x';
    if (kind === 'expired') order.qrTokenExpiresAt = new Date(0);
    if (kind === 'receipt-revoked') order.receiptAccessRevokedAt = new Date();
    await expect(service.read('cafe', target, credential)).rejects.toThrow();
  });
  it('rejects invalid confirmed/unpaid state rather than claiming confirmation', async () => {
    order.status = 'CONFIRMED';
    order.decidedAt = new Date();
    await expect(
      service.read('cafe', id, tokens.issueTracking(order)),
    ).rejects.toMatchObject({ response: { code: 'INVALID_ORDER_STATE' } });
  });
  it.each(['PENDING_CONFIRMATION', 'REJECTED'])(
    'rejects contradictory paid %s state',
    async (status) => {
      order.status = status;
      order.paymentStatus = 'PAID';
      await expect(
        service.read('cafe', id, tokens.issueTracking(order)),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_ORDER_STATE' },
      });
    },
  );
});
