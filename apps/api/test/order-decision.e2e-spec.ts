import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ShopRole } from '@paserve/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { OrderTokenService } from '../src/modules/orders/order-token.service.js';
import { OrderQrService } from '../src/modules/orders/order-qr.service.js';

describe('Cashier order decisions', () => {
  let app: INestApplication<App>;
  let tokens: OrderTokenService;
  let qr: OrderQrService;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681';
  const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
  const otherShop = '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24';
  const orderId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const auth = vi.fn();
  const membership = vi.fn();
  const findOrder = vi.fn();
  const updateOrder = vi.fn();
  const raw = vi.fn();
  const transaction = vi.fn();
  const database = {
    order: { findFirst: findOrder, updateMany: updateOrder },
    $queryRaw: raw,
  };
  let role: ShopRole;
  let active: boolean;
  let saved: ReturnType<typeof fixture>;
  let token: string;
  let version: string;
  function fixture() {
    return {
      id: orderId,
      shopId,
      orderNumber: 'ORD-000042',
      mode: 'TAKEOUT' as const,
      status: 'PENDING_CONFIRMATION',
      paymentStatus: 'UNPAID',
      currency: 'PHP',
      totalPrice: new Prisma.Decimal('10.00'),
      tableNumber: null,
      ...tokens.metadata(),
      qrTokenRevokedAt: null as Date | null,
      orderItems: [
        {
          lineNumber: 1,
          productSnapshotId: 'product',
          productNameSnapshot: 'Saved coffee',
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
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        ...database,
        shopMember: { findUnique: membership },
        $transaction: transaction,
      })
      .overrideProvider(AuthService)
      .useValue({ currentUser: auth })
      .compile();
    tokens = module.get(OrderTokenService);
    qr = module.get(OrderQrService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    role = 'CASHIER';
    active = true;
    saved = fixture();
    token = tokens.issue(saved);
    auth.mockResolvedValue({
      id: userId,
      memberships: [{ shopId, role: 'OWNER' }],
    });
    membership.mockImplementation(async ({ where }) => ({
      shopId: where.userId_shopId.shopId,
      role,
      user: { isActive: active },
      shop: {
        id: where.userId_shopId.shopId,
        name: 'Cafe',
        slug: 'cafe',
        isActive: active,
      },
    }));
    findOrder.mockImplementation(async ({ where }) =>
      (where.id === orderId ||
        (where.id === undefined && where.orderNumber === saved.orderNumber)) &&
      where.shopId === shopId &&
      (where.orderNumber === undefined ||
        where.orderNumber === saved.orderNumber) &&
      active &&
      where.shop.members.some.role.in.includes(role)
        ? saved
        : null,
    );
    raw.mockResolvedValue([{ id: orderId }]);
    transaction.mockImplementation(async (work) => work(database));
    updateOrder.mockImplementation(async ({ where, data }) => {
      if (
        saved.status !== where.status ||
        saved.paymentStatus !== where.paymentStatus ||
        (where.qrTokenRevokedAt !== undefined && saved.qrTokenRevokedAt) ||
        (where.qrTokenExpiresAt &&
          saved.qrTokenExpiresAt <= where.qrTokenExpiresAt.gt) ||
        (where.orderNumber && saved.orderNumber !== where.orderNumber) ||
        !active ||
        !where.shop.members.some.role.in.includes(role)
      )
        return { count: 0 };
      Object.assign(saved, data);
      return { count: 1 };
    });
    version = (await qr.verify(userId, shopId, orderId, token)).order
      .reviewVersion;
    findOrder.mockClear();
  });
  function decide(
    action = 'reject',
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/${action}`,
    );
    if (authenticated) req.set('Authorization', 'Bearer staff-session');
    return req.send({ qrToken: token, reviewVersion: version, ...body });
  }
  function numberRequest(
    action = 'lookup-number',
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const path = action === 'lookup-number' ? action : `${orderId}/${action}`;
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${path}`,
    );
    if (authenticated) req.set('Authorization', 'Bearer staff-session');
    return req.send({
      orderNumber: saved.orderNumber,
      ...(action === 'lookup-number' ? {} : { reviewVersion: version }),
      ...body,
    });
  }
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'allows live %s to find a number and rejects using current saved details',
    async (currentRole) => {
      role = currentRole;
      const review = await numberRequest().expect(200);
      expect(review.headers['cache-control']).toBe('no-store');
      expect(review.body.order.id).toBe(orderId);
      expect(review.body.order.orderNumber).toBe(saved.orderNumber);
      expect(review.body.order.qrToken).toBeUndefined();
      expect(review.body.order.reviewVersion).toBe(version);
      const result = await numberRequest('reject-number').expect(200);
      expect(result.body.order).toMatchObject({
        status: 'REJECTED',
        paymentStatus: 'UNPAID',
        decidedBy: userId,
      });
    },
  );
  it('rejects by number with a saved reason and rejects repeated decisions', async () => {
    const result = await numberRequest('reject-number', {
      rejectionReason: 'Customer cancelled.',
    }).expect(200);
    expect(result.body.order).toMatchObject({
      status: 'REJECTED',
      paymentStatus: 'UNPAID',
      rejectionReason: 'Customer cancelled.',
    });
    await numberRequest('reject-number').expect(409);
    await numberRequest('reject-number').expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it('allows authorized manual fallback for an expired QR without making QR verification accept it', async () => {
    saved.qrTokenExpiresAt = new Date(0);
    await decide().expect(403);
    await numberRequest().expect(200);
    await numberRequest('reject-number').expect(200);
    expect(saved.paymentStatus).toBe('UNPAID');
  });
  it.each(['lookup-number', 'confirm-number', 'reject-number'])(
    'denies guests and kitchen staff for %s',
    async (action) => {
      await numberRequest(action, {}, shopId, false).expect(401);
      role = 'KITCHEN';
      await numberRequest(action).expect(403);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['lookup-number', 'confirm-number', 'reject-number'])(
    'does not read/process another shop number through %s',
    async (action) => {
      await numberRequest(action, {}, otherShop).expect(404);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['CONFIRMED', 'REJECTED', 'UNKNOWN'])(
    'rejects a manual lookup of state %s',
    async (status) => {
      saved.status = status;
      await numberRequest().expect(409);
      await numberRequest('reject-number').expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rechecks manual lookup access in the resource read', async () => {
    findOrder.mockResolvedValueOnce(null);
    await numberRequest().expect(404);
  });
  it('rejects a manual number/ID mismatch and a stale reviewed version', async () => {
    await numberRequest('reject-number', { orderNumber: 'ORD-000999' }).expect(
      404,
    );
    await numberRequest('reject-number', {
      reviewVersion: 'b'.repeat(64),
    }).expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('normalizes pasted numbers and rejects values outside the server numbering range', async () => {
    await numberRequest('lookup-number', {
      orderNumber: ' ord-000042 ',
    }).expect(200);
    for (const orderNumber of [
      'ORD-000000',
      'ORD-9223372036854775808',
      orderId,
    ])
      await numberRequest('lookup-number', { orderNumber }).expect(400);
  });
  it('rejects mixed credentials or client-supplied statuses on manual routes', async () => {
    await numberRequest('reject-number', { qrToken: token }).expect(400);
    await numberRequest('reject-number', { paymentStatus: 'PAID' }).expect(400);
    await numberRequest('lookup-number', { shopId: otherShop }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('retains pending/unpaid/shop/number predicates in manual writes', async () => {
    await numberRequest('reject-number').expect(200);
    expect(updateOrder).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: orderId,
        shopId,
        orderNumber: 'ORD-000042',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'UNPAID',
      }),
      data: expect.objectContaining({
        status: 'REJECTED',
        qrTokenRevokedAt: expect.any(Date),
      }),
    });
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'allows live %s rejection with unpaid payment and recorded actor',
    async (currentRole) => {
      role = currentRole;
      const response = await decide().expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.order).toMatchObject({
        id: orderId,
        shopId,
        orderNumber: 'ORD-000042',
        status: 'REJECTED',
        paymentStatus: 'UNPAID',
        decidedBy: userId,
        rejectionReason: null,
      });
      expect(saved.qrTokenRevokedAt).toBeInstanceOf(Date);
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
        timeout: 15000,
      });
    },
  );
  it('rejects with a trimmed reason and preserves saved order amounts', async () => {
    const result = await decide('reject', {
      rejectionReason: '  Customer changed their mind.  ',
    }).expect(200);
    expect(result.body.order).toMatchObject({
      status: 'REJECTED',
      paymentStatus: 'UNPAID',
      rejectionReason: 'Customer changed their mind.',
    });
    expect(saved.totalPrice.toFixed(2)).toBe('10.00');
  });
  it('allows rejection without a reason', async () => {
    const result = await decide('reject').expect(200);
    expect(result.body.order.rejectionReason).toBeNull();
  });
  it.each(['confirm', 'reject', 'confirm-number', 'reject-number'])(
    'blocks %s when saved receipt metadata is invalid',
    async (action) => {
      saved.orderItems[0].productNameSnapshot = '';
      const result = await (
        action.endsWith('-number') ? numberRequest(action) : decide(action)
      ).expect(409);
      expect(result.body.code).toBe('ORDER_DETAILS_UNAVAILABLE');
      expect(updateOrder).not.toHaveBeenCalled();
      expect(saved.status).toBe('PENDING_CONFIRMATION');
      expect(saved.paymentStatus).toBe('UNPAID');
      expect(saved.qrTokenRevokedAt).toBeNull();
    },
  );
  it.each(['confirm', 'reject'])(
    'denies unauthenticated %s',
    async (action) => {
      await decide(action, {}, shopId, false).expect(401);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['confirm', 'reject'])(
    'denies kitchen %s even with cached OWNER claims',
    async (action) => {
      role = 'KITCHEN';
      await decide(action).expect(403);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('denies cross-shop access without a mutation', async () => {
    await decide('confirm', {}, otherShop).expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks revoked live access after the guard', async () => {
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await decide().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(
    ['CONFIRMED', 'REJECTED', 'COMPLETED', 'UNKNOWN'].flatMap((status) =>
      ['confirm', 'reject'].map((action) => ({ status, action })),
    ),
  )(
    'rejects $action from disallowed state $status',
    async ({ status, action }) => {
      saved.status = status;
      await decide(action).expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['signature', 'expiry', 'revocation', 'nonce'])(
    'rejects %s token failure before mutation',
    async (failure) => {
      if (failure === 'signature') token = `${token.slice(0, -1)}!`;
      if (failure === 'expiry') saved.qrTokenExpiresAt = new Date(0);
      if (failure === 'revocation') saved.qrTokenRevokedAt = new Date();
      if (failure === 'nonce') saved.qrTokenNonce = otherShop;
      await decide().expect(403);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects changed saved details since review', async () => {
    saved.orderItems[0].productNameSnapshot = 'Changed receipt';
    const result = await decide().expect(409);
    expect(result.body.code).toBe('ORDER_REVIEW_CHANGED');
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects missing receipt lines', async () => {
    saved.orderItems = [];
    await decide().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects changed payment state', async () => {
    saved.paymentStatus = 'PAID';
    await decide().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('repeats state, expiry, shop and live role predicates in the conditional write', async () => {
    await decide().expect(200);
    expect(updateOrder).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: orderId,
        shopId,
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'UNPAID',
        qrTokenRevokedAt: null,
        qrTokenExpiresAt: { gt: expect.any(Date) },
        shop: expect.objectContaining({
          members: {
            some: {
              userId,
              role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
              user: { isActive: true },
            },
          },
        }),
      }),
      data: expect.objectContaining({
        status: 'REJECTED',
        decidedBy: userId,
        qrTokenRevokedAt: expect.any(Date),
      }),
    });
  });
  it('returns conflict when the final conditional write loses eligibility', async () => {
    updateOrder.mockResolvedValueOnce({ count: 0 });
    await decide().expect(409);
  });
  it('does not replay a completed decision or a consumed token', async () => {
    await decide().expect(200);
    await decide().expect(403);
    await decide('reject').expect(403);
    expect(updateOrder).toHaveBeenCalledTimes(1);
    expect(saved.status).toBe('REJECTED');
    expect(saved.paymentStatus).toBe('UNPAID');
  });
  it('turns serialization conflict into a review conflict without automatic mutation retry', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Write conflict', {
        code: 'P2034',
        clientVersion: '7.10.0',
      }),
    );
    await decide().expect(409);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 'CONFIRMED' },
    { paymentStatus: 'PAID' },
    { decidedBy: otherShop },
    { reviewVersion: '' },
    { reviewVersion: 'z'.repeat(64) },
    { rejectionReason: 'Not allowed on confirm' },
  ])('rejects invalid or untrusted confirm fields %j', async (body) => {
    await decide('confirm', body).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['a'.repeat(301), '\u0000', '\u202e'])(
    'rejects invalid rejection reason',
    async (rejectionReason) => {
      await decide('reject', { rejectionReason }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['confirm', 'confirm-number'])(
    'requires payment rather than standalone %s',
    async (action) => {
      const result = await (
        action === 'confirm' ? decide(action) : numberRequest(action)
      ).expect(409);
      expect(result.body.code).toBe('PAYMENT_REQUIRED');
      expect(saved.status).toBe('PENDING_CONFIRMATION');
      expect(saved.paymentStatus).toBe('UNPAID');
      expect(saved.qrTokenRevokedAt).toBeNull();
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
});
