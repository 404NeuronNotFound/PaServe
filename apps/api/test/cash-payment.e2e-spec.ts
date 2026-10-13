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
import { CashPaymentService } from '../src/modules/orders/cash-payment.service.js';

describe('Cash collection', () => {
  let app: INestApplication<App>,
    tokens: OrderTokenService,
    cash: CashPaymentService;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681',
    shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
    orderId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const requestId = '58bb31e6-9c13-4c07-9e04-fbb29b0584ab';
  const auth = vi.fn(),
    membership = vi.fn(),
    findOrder = vi.fn(),
    updateOrder = vi.fn(),
    raw = vi.fn(),
    transaction = vi.fn();
  const database = {
    order: { findFirst: findOrder, updateMany: updateOrder },
    $queryRaw: raw,
  };
  let role: ShopRole,
    active: boolean,
    saved: ReturnType<typeof fixture>,
    version: string;
  function fixture() {
    return {
      id: orderId,
      shopId,
      orderNumber: 'ORD-000042',
      mode: 'TAKEOUT',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      currency: 'PHP',
      totalPrice: new Prisma.Decimal('135.50'),
      tableNumber: null,
      ...tokens.metadata(),
      qrTokenRevokedAt: new Date(),
      paymentMethod: null,
      paymentRequestId: null,
      paymentReviewVersion: null,
      paymentReference: null,
      paymentDescription: null,
      amountReceived: null,
      changeDue: null,
      paidAt: null,
      paidBy: null,
      orderItems: [
        {
          lineNumber: 1,
          productSnapshotId: 'coffee',
          productNameSnapshot: 'Coffee',
          currency: 'PHP',
          quantity: 1,
          notes: null,
          basePriceSnapshot: new Prisma.Decimal('135.50'),
          unitPriceSnapshot: new Prisma.Decimal('135.50'),
          lineTotalSnapshot: new Prisma.Decimal('135.50'),
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
    cash = module.get(CashPaymentService);
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
      (where.id === undefined || where.id === orderId) &&
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
        where.shopId !== shopId ||
        where.id !== orderId ||
        saved.status !== where.status ||
        saved.paymentStatus !== where.paymentStatus ||
        !active ||
        !where.shop.members.some.role.in.includes(role)
      )
        return { count: 0 };
      Object.assign(saved, data);
      return { count: 1 };
    });
    version = (await cash.review(userId, shopId, orderId)).order.reviewVersion;
    findOrder.mockClear();
  });
  function collect(
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/cash-payment`,
    );
    if (authenticated) req.set('Authorization', 'Bearer session');
    return req.send({
      requestId,
      reviewVersion: version,
      amountReceived: '200.00',
      ...body,
    });
  }
  function read() {
    return request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/orders/${orderId}/cash-payment`)
      .set('Authorization', 'Bearer session');
  }
  function other(
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/other-payment`,
    );
    if (authenticated) req.set('Authorization', 'Bearer session');
    return req.send({
      requestId,
      reviewVersion: version,
      receivedConfirmed: true,
      description: 'Bank transfer',
      ...body,
    });
  }
  it.each(['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])(
    'records the authenticated cashier and server time for %s',
    async (method) => {
      const before = Date.now();
      const result = await (
        method === 'CASH'
          ? collect()
          : method === 'GCASH_MANUAL'
            ? gcash()
            : method === 'CARD_MANUAL'
              ? card()
              : other()
      ).expect(200);
      expect(result.body.payment.paidBy).toBe(userId);
      expect(saved.paidBy).toBe(userId);
      expect(Date.parse(result.body.payment.paidAt)).toBeGreaterThanOrEqual(
        before,
      );
      expect(Date.parse(result.body.payment.paidAt)).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(updateOrder.mock.calls[0][0].where.shop.members.some.userId).toBe(
        userId,
      );
    },
  );
  it.each(['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])(
    'rejects client cashier/membership/time hints for %s',
    async (method) => {
      const forged = {
        paidBy: '75992537-5d60-4d22-8e1e-60a114644682',
        paidAt: '2000-01-01T00:00:00.000Z',
        cashierId: 'other-cashier',
        shopMemberId: 'other-membership',
        role: 'OWNER',
      };
      await (
        method === 'CASH'
          ? collect(forged)
          : method === 'GCASH_MANUAL'
            ? gcash(forged)
            : method === 'CARD_MANUAL'
              ? card(forged)
              : other(forged)
      ).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('does not let another authenticated cashier replay or replace original attribution', async () => {
    await collect().expect(200);
    auth.mockResolvedValue({
      id: '75992537-5d60-4d22-8e1e-60a114644682',
      memberships: [],
    });
    await collect().expect(409);
    expect(saved.paidBy).toBe(userId);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['CASHIER', 'OWNER', 'ADMIN', 'MANAGER'] as const)(
    'records controlled OTHER payment for live %s',
    async (currentRole) => {
      role = currentRole;
      const result = await other({
        description: '  Bank transfer  ',
        reference: '  00001234 bank receipt  ',
      }).expect(200);
      expect(result.body.payment).toMatchObject({
        method: 'OTHER',
        description: 'Bank transfer',
        reference: '00001234 bank receipt',
        amountReceived: '135.50',
        changeDue: '0.00',
        paidBy: userId,
      });
      expect(saved.paymentDescription).toBe('Bank transfer');
      expect(saved.paymentMethod).toBe('OTHER');
      expect(saved.paymentStatus).toBe('PAID');
      expect((await read().expect(200)).body).toEqual(result.body);
      expect(
        (await other({ reference: '00001234 bank receipt' }).expect(200)).body,
      ).toEqual(result.body);
      await other({
        description: 'Shop voucher',
        reference: '00001234 bank receipt',
      }).expect(409);
      await collect().expect(409);
      await gcash().expect(409);
      await card().expect(409);
      expect(updateOrder).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    undefined,
    null,
    '',
    '   ',
    123,
    'a'.repeat(81),
    'line\nnext',
    '<script>',
    '4111 1111 1111 1111',
    'CVV: 123',
  ])('rejects invalid OTHER description %j', async (description) => {
    await other({ description }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([
    '4111111111111111',
    '4111-1111-1111-1111',
    'CVV: 123',
    '１２３４５６７８９０１２３４５６',
  ])('rejects card details in OTHER reference %s', async (reference) => {
    await other({ reference }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('allows an omitted OTHER reference', async () => {
    expect((await other().expect(200)).body.payment.reference).toBeNull();
  });
  it.each([false, null, undefined, 'true'])(
    'requires OTHER full-payment confirmation %j',
    async (receivedConfirmed) => {
      await other({ receivedConfirmed }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['PENDING_CONFIRMATION', 'REJECTED'])(
    'rejects OTHER for %s orders',
    async (status) => {
      saved.status = status;
      await other().expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects forged settlement hints and stale OTHER details', async () => {
    await other({
      amountReceived: '1.00',
      changeDue: '1.00',
      paidBy: 'owner',
      method: 'CASH',
    }).expect(400);
    saved.orderItems[0].productNameSnapshot = 'Changed';
    await other().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('enforces OTHER authentication, live role and tenant scope', async () => {
    await other({}, shopId, false).expect(401);
    await other({}, '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24').expect(404);
    role = 'KITCHEN';
    await other().expect(403);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks OTHER permission inside transaction', async () => {
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await other().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['cash', 'gcash', 'card'])(
    'cannot record OTHER after %s',
    async (method) => {
      await (
        method === 'cash' ? collect() : method === 'card' ? card() : gcash()
      ).expect(200);
      await other().expect(409);
      expect(updateOrder).toHaveBeenCalledTimes(1);
    },
  );
  function card(
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/card-manual-payment`,
    );
    if (authenticated) req.set('Authorization', 'Bearer session');
    return req.send({
      requestId,
      reviewVersion: version,
      receivedConfirmed: true,
      ...body,
    });
  }
  it.each(['CASHIER', 'OWNER', 'ADMIN', 'MANAGER'] as const)(
    'records completed external card payment for live %s',
    async (currentRole) => {
      role = currentRole;
      const result = await card({
        reference: '  00001234 terminal receipt  ',
      }).expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.payment).toMatchObject({
        method: 'CARD_MANUAL',
        amountReceived: '135.50',
        changeDue: '0.00',
        paidBy: userId,
        reference: '00001234 terminal receipt',
      });
      expect(saved.paymentMethod).toBe('CARD_MANUAL');
      expect(saved.paymentStatus).toBe('PAID');
      expect((await read().expect(200)).body).toEqual(result.body);
      expect(
        (await card({ reference: '00001234 terminal receipt' }).expect(200))
          .body,
      ).toEqual(result.body);
      await card({ reference: 'different receipt' }).expect(409);
      await collect().expect(409);
      await gcash().expect(409);
      expect(updateOrder).toHaveBeenCalledTimes(1);
    },
  );
  it.each([undefined, null, '', '   '])(
    'allows an optional card reference %j',
    async (reference) => {
      expect(
        (await card({ reference }).expect(200)).body.payment.reference,
      ).toBeNull();
    },
  );
  it.each([false, undefined, 'true', null, 1])(
    'rejects unconfirmed card completion %j',
    async (receivedConfirmed) => {
      await card({ receivedConfirmed }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it.each(['PENDING_CONFIRMATION', 'REJECTED'])(
    'rejects card settlement for %s orders',
    async (status) => {
      saved.status = status;
      await card().expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects stale card review and forged amount/actor/method/gateway fields', async () => {
    await card({
      amountReceived: '1.00',
      paidBy: 'owner',
      method: 'CASH',
      gatewayVerified: true,
    }).expect(400);
    saved.orderItems[0].productNameSnapshot = 'Changed';
    await card().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([123, 'a'.repeat(201), 'line\nnext', '<script>', 'ref\u202e'])(
    'rejects malformed card reference %j',
    async (reference) => {
      await card({ reference }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('enforces card authentication, live role and shop scope', async () => {
    await card({}, shopId, false).expect(401);
    await card({}, '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24').expect(404);
    role = 'KITCHEN';
    await card().expect(403);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks card permission inside the payment transaction', async () => {
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await card().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['cash', 'gcash'])('cannot record card after %s', async (method) => {
    await (method === 'cash' ? collect() : gcash()).expect(200);
    await card().expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  function gcash(
    body: Record<string, unknown> = {},
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/gcash-manual-payment`,
    );
    if (authenticated) req.set('Authorization', 'Bearer session');
    return req.send({
      requestId,
      reviewVersion: version,
      receivedConfirmed: true,
      ...body,
    });
  }
  it('stores optional GCash reference as text and rejects altered retries', async () => {
    const result = await gcash({
      reference: '  001234567890 - checked receipt  ',
    }).expect(200);
    expect(result.body.payment.reference).toBe(
      '001234567890 - checked receipt',
    );
    expect(saved.paymentReference).toBe('001234567890 - checked receipt');
    expect((await read().expect(200)).body.payment.reference).toBe(
      '001234567890 - checked receipt',
    );
    expect(
      (await gcash({ reference: '001234567890 - checked receipt' }).expect(200))
        .body,
    ).toEqual(result.body);
    await gcash({ reference: 'different reference' }).expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, '', '   '])(
    'accepts omitted or blank optional GCash reference: %j',
    async (reference) => {
      const result = await gcash({ reference }).expect(200);
      expect(result.body.payment.reference).toBeNull();
      expect(saved.paymentReference).toBeNull();
    },
  );
  it.each([
    12345,
    'a'.repeat(201),
    'line\nnext',
    '<script>',
    'ref\u0000',
    'ref\u202e',
  ])('rejects invalid GCash reference: %j', async (reference) => {
    await gcash({ reference }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'records manually verified GCash for live %s',
    async (currentRole) => {
      role = currentRole;
      const result = await gcash().expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.order.paymentStatus).toBe('PAID');
      expect(result.body.payment).toMatchObject({
        method: 'GCASH_MANUAL',
        amountReceived: '135.50',
        changeDue: '0.00',
        paidBy: userId,
        requestId,
      });
      expect(saved.paymentMethod).toBe('GCASH_MANUAL');
      expect((await read().expect(200)).body.payment.method).toBe(
        'GCASH_MANUAL',
      );
      expect((await gcash().expect(200)).body).toEqual(result.body);
      expect(updateOrder).toHaveBeenCalledTimes(1);
    },
  );
  it.each([false, 'true', null, 1])(
    'rejects unverified GCash receipt %j',
    async (receivedConfirmed) => {
      await gcash({ receivedConfirmed }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects missing GCash attestation and forged settlement fields', async () => {
    await gcash({ receivedConfirmed: undefined }).expect(400);
    await gcash({
      amountReceived: '1.00',
      changeDue: '9.00',
      paidBy: 'owner',
      paymentMethod: 'CASH',
    }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('prevents cash overwriting GCash and GCash overwriting cash', async () => {
    await gcash().expect(200);
    await collect().expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it('prevents GCash recording after cash settlement', async () => {
    await collect().expect(200);
    await gcash().expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['PENDING_CONFIRMATION', 'REJECTED'])(
    'rejects GCash for %s orders',
    async (status) => {
      saved.status = status;
      await gcash().expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('rejects stale GCash review', async () => {
    saved.orderItems[0].productNameSnapshot = 'Changed';
    await gcash().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('enforces GCash authentication, current role and shop isolation', async () => {
    await gcash({}, shopId, false).expect(401);
    await gcash({}, '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24').expect(404);
    role = 'KITCHEN';
    await gcash().expect(403);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks GCash permission inside transaction', async () => {
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await gcash().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const)(
    'allows live %s and saves cash/change once',
    async (currentRole) => {
      role = currentRole;
      const result = await collect().expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.order).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        totalPrice: '135.50',
      });
      expect(result.body.payment).toMatchObject({
        method: 'CASH',
        requestId,
        amountReceived: '200.00',
        changeDue: '64.50',
        paidBy: userId,
      });
      expect(result.body.order.qrTokenNonce).toBeUndefined();
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(updateOrder.mock.calls[0][0].where).toMatchObject({
        id: orderId,
        shopId,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
      });
    },
  );
  it('returns identical receipt on exact request replay without another update', async () => {
    const first = await collect().expect(200);
    const replay = await collect().expect(200);
    expect(replay.body).toEqual(first.body);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it.each([
    { requestId: '08c6dcb9-a03f-45a7-ae1e-ec326ad980a5' },
    { amountReceived: '300.00' },
    { reviewVersion: 'b'.repeat(64) },
  ])('rejects duplicate collection with changed request: %j', async (body) => {
    await collect().expect(200);
    const result = await collect(body).expect(409);
    expect(result.body.code).toBe('ORDER_ALREADY_PAID');
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
  it('supports exact cash with zero change', async () => {
    expect(
      (await collect({ amountReceived: '135.50' }).expect(200)).body.payment
        .changeDue,
    ).toBe('0.00');
  });
  it('rejects client total and change overrides without a payment write', async () => {
    await collect({ totalPrice: '0.01', changeDue: '999.99' }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
    expect(saved.paymentStatus).toBe('UNPAID');
  });
  it('captures fractional tender using exact decimals', async () => {
    saved.totalPrice = new Prisma.Decimal('0.10');
    for (const field of [
      'basePriceSnapshot',
      'unitPriceSnapshot',
      'lineTotalSnapshot',
    ] as const)
      saved.orderItems[0][field] = new Prisma.Decimal('0.10');
    version = (await cash.review(userId, shopId, orderId)).order.reviewVersion;
    const result = await collect({ amountReceived: '0.30' }).expect(200);
    expect(result.body.payment.amountReceived).toBe('0.30');
    expect(result.body.payment.changeDue).toBe('0.20');
    expect(saved.amountReceived!.toFixed(2)).toBe('0.30');
  });
  it('accepts the Decimal(12,2) tender limit without rounding', async () => {
    const result = await collect({ amountReceived: '9999999999.99' }).expect(
      200,
    );
    expect(result.body.payment.amountReceived).toBe('9999999999.99');
    expect(result.body.payment.changeDue).toBe('9999999864.49');
    expect(saved.amountReceived!.toFixed(2)).toBe('9999999999.99');
  });
  it('rejects underpayment without mutation', async () => {
    expect(
      (await collect({ amountReceived: '135.49' }).expect(400)).body.code,
    ).toBe('CASH_AMOUNT_INSUFFICIENT');
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([
    '-1.00',
    '1e3',
    '200',
    '200.001',
    '10000000000.00',
    ' 200.00',
    'NaN',
    'Infinity',
    '+200.00',
    '200.00abc',
    '1,000.00',
    '1_000.00',
    '',
    '200.00\n',
    200,
    null,
  ])('rejects malformed amount: %j', async (amountReceived) => {
    await collect({ amountReceived }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['PENDING_CONFIRMATION', 'REJECTED'])(
    'cannot collect a %s order',
    async (status) => {
      saved.status = status;
      const result = await collect().expect(409);
      expect(result.body.code).toBe('ORDER_NOT_CONFIRMED');
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('cannot collect with a stale review', async () => {
    saved.orderItems[0].productNameSnapshot = 'Changed';
    expect((await collect().expect(409)).body.code).toBe(
      'ORDER_REVIEW_CHANGED',
    );
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('blocks malformed receipt details', async () => {
    saved.orderItems[0].productNameSnapshot = '';
    expect((await collect().expect(409)).body.code).toBe(
      'ORDER_DETAILS_UNAVAILABLE',
    );
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('denies anonymous collection', async () => {
    await collect({}, shopId, false).expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('denies kitchen even with cached OWNER claims', async () => {
    role = 'KITCHEN';
    await collect().expect(403);
    await read().expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('denies cross-shop collection', async () => {
    await collect({}, '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24').expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks role after guard', async () => {
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await collect().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('fails conditional update races', async () => {
    updateOrder.mockResolvedValueOnce({ count: 0 });
    await collect().expect(409);
  });
  it('maps serialization conflicts safely', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '7',
      }),
    );
    await collect().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects forged payment fields', async () => {
    await collect({
      changeDue: '999.00',
      paidBy: 'owner',
      paymentStatus: 'PAID',
    }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('loads paid receipt by number and does not rewrite it', async () => {
    await collect().expect(200);
    const result = await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/cash-payment/lookup-number`)
      .set('Authorization', 'Bearer session')
      .send({ orderNumber: ' ord-000042 ' })
      .expect(200);
    expect(result.body.payment.changeDue).toBe('64.50');
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
});
