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
