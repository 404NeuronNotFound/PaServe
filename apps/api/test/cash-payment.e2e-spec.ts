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
import { OrderQrService } from '../src/modules/orders/order-qr.service.js';

describe('Cash collection', () => {
  let app: INestApplication<App>,
    tokens: OrderTokenService,
    cash: CashPaymentService;
  let qr: OrderQrService;
  let pendingToken: string;
  const userId = '75992537-5d60-4d22-8e1e-60a114644681',
    shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e',
    orderId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
  const requestId = '58bb31e6-9c13-4c07-9e04-fbb29b0584ab';
  const auth = vi.fn(),
    membership = vi.fn(),
    findOrder = vi.fn(),
    findQueue = vi.fn(),
    aggregateOrders = vi.fn(),
    aggregateItems = vi.fn(),
    groupPayments = vi.fn(),
    reportAccess = vi.fn(),
    updateOrder = vi.fn(),
    raw = vi.fn(),
    transaction = vi.fn();
  const database = {
    shop: { findFirst: reportAccess },
    orderItem: { aggregate: aggregateItems },
    order: {
      findFirst: findOrder,
      updateMany: updateOrder,
      findMany: findQueue,
      aggregate: aggregateOrders,
      groupBy: groupPayments,
    },
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
      preparationStatus: null as string | null,
      queuedAt: null as Date | null,
      preparationStartedAt: null as Date | null,
      preparationStartedBy: null as string | null,
      preparationReadyAt: null as Date | null,
      preparationReadyBy: null as string | null,
      completedAt: null as Date | null,
      completedBy: null as string | null,
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
    reportAccess.mockImplementation(async ({ where }) => active && where.id === shopId && where.members.some.role.in.includes(role) ? { id: shopId } : null);
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
    raw.mockImplementation(async (parts: TemplateStringsArray) =>
      parts.join('').includes('clock_timestamp')
        ? [{ now: new Date() }]
        : [{ id: orderId }],
    );
    findQueue.mockImplementation(async ({ where }) =>
      where.shopId === shopId &&
      active &&
      where.shop.members.some.role.in.includes(role) &&
      saved.status === where.status &&
      saved.paymentStatus === where.paymentStatus &&
      saved.preparationStatus === where.preparationStatus
        ? [saved]
        : [],
    );
    transaction.mockImplementation(async (work) => work(database));
    aggregateItems.mockResolvedValue({ _sum: { quantity: 7 } });
    groupPayments.mockResolvedValue([{ paymentMethod: 'CASH', _count: { _all: 2 }, _sum: { totalPrice: new Prisma.Decimal('0.30') } }]);
    aggregateOrders.mockImplementation(async ({ where }) => {
      const eligible =
        active &&
        where.shopId === shopId &&
        where.shop.members.some.role.in.includes(role) &&
        saved.status === where.status &&
        saved.paymentStatus === where.paymentStatus &&
        saved.preparationStatus === where.preparationStatus &&
        saved.completedAt &&
        saved.completedAt >= where.completedAt.gte &&
        saved.completedAt < where.completedAt.lt;
      return {
        _count: { _all: eligible ? 1 : 0 },
        _sum: { totalPrice: eligible ? saved.totalPrice : null },
      };
    });
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
  async function preparePending() {
    saved.status = 'PENDING_CONFIRMATION';
    saved.qrTokenRevokedAt = null as unknown as Date;
    pendingToken = tokens.issue(saved);
    version = (await qr.verify(userId, shopId, orderId, pendingToken)).order
      .reviewVersion;
  }
  function atomic(
    method = 'CASH',
    body: Record<string, unknown> = {},
    byNumber = false,
    targetShop = shopId,
    authenticated = true,
  ) {
    const req = request(app.getHttpServer()).post(
      `/api/v1/shops/${targetShop}/orders/${orderId}/create-payment`,
    );
    if (authenticated) req.set('Authorization', 'Bearer session');
    return req.send({
      requestId,
      reviewVersion: version,
      method,
      ...(byNumber
        ? { orderNumber: saved.orderNumber }
        : { qrToken: pendingToken }),
      ...(method === 'CASH'
        ? { amountReceived: '200.00' }
        : { receivedConfirmed: true }),
      ...(method === 'OTHER' ? { description: 'Shop voucher' } : {}),
      ...body,
    });
  }
  it.each(
    ['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'].flatMap((method) =>
      [false, true].map((byNumber) => ({ method, byNumber })),
    ),
  )(
    'atomically confirms and pays $method byNumber=$byNumber',
    async ({ method, byNumber }) => {
      await preparePending();
      const result = await atomic(method, {}, byNumber).expect(200);
      expect(result.body.order).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });
      expect(result.body.payment).toMatchObject({ method, paidBy: userId });
      expect(saved).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        decidedBy: userId,
        paidBy: userId,
      });
      expect(saved.qrTokenRevokedAt).toBeInstanceOf(Date);
      expect(saved.preparationStatus).toBe('QUEUED');
      expect(saved.queuedAt).toEqual(saved.paidAt);
      expect(result.body.queue).toEqual({
        status: 'QUEUED',
        queuedAt: saved.queuedAt!.toISOString(),
      });
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(updateOrder.mock.calls[0][0].where).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'UNPAID',
        shopId,
      });
      expect(updateOrder.mock.calls[0][0].data).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
        timeout: 15000,
      });
      expect((await atomic(method, {}, byNumber).expect(200)).body).toEqual(
        result.body,
      );
      expect(updateOrder).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps confirmation pending when cash is insufficient or input is forged', async () => {
    await preparePending();
    await atomic('CASH', { amountReceived: '135.49' }).expect(400);
    await atomic('CASH', { paidBy: 'owner', paymentStatus: 'PAID' }).expect(
      400,
    );
    expect(saved.status).toBe('PENDING_CONFIRMATION');
    expect(saved.paymentStatus).toBe('UNPAID');
    expect(saved.preparationStatus).toBeNull();
    expect(saved.queuedAt).toBeNull();
    expect(saved.qrTokenRevokedAt).toBeNull();
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'] as const)(
    'lets %s read the persisted paid queue without payment details',
    async (queueRole) => {
      await preparePending();
      await atomic().expect(200);
      role = queueRole;
      const response = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/queue`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0]).toMatchObject({
        id: orderId,
        shopId,
        preparationStatus: 'QUEUED',
        totalPrice: '135.50',
      });
      expect(response.body.orders[0]).not.toHaveProperty('paymentReference');
      expect(response.body.orders[0]).not.toHaveProperty('paidBy');
      expect(findQueue.mock.calls[0][0].where).toMatchObject({
        shopId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'QUEUED',
      });
    },
  );
  it.each(['PREPARING', 'READY'])(
    'excludes paid orders from queued work once they are %s',
    async (preparationStatus) => {
      await preparePending();
      await atomic().expect(200);
      role = 'KITCHEN';
      saved.preparationStatus = preparationStatus;
      const before = JSON.stringify(saved);
      updateOrder.mockClear();
      const response = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/queue`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(response.body).toEqual({ orders: [], nextCursor: null });
      expect(JSON.stringify(saved)).toBe(before);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('keeps accepted paid orders queued across reads until preparation starts', async () => {
    await preparePending();
    await atomic().expect(200);
    role = 'KITCHEN';
    const before = JSON.stringify(saved);
    updateOrder.mockClear();
    for (let index = 0; index < 2; index++) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/queue`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0]).toMatchObject({
        id: orderId,
        preparationStatus: 'QUEUED',
      });
    }
    expect(JSON.stringify(saved)).toBe(before);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('denies cashier, anonymous and revoked queue access', async () => {
    const path = `/api/v1/shops/${shopId}/preparation/queue`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer session')
      .expect(403);
    role = 'KITCHEN';
    active = false;
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer session')
      .expect(404);
    expect(findQueue).not.toHaveBeenCalled();
  });
  const start = (
    body: Record<string, unknown> = {},
    targetShop = shopId,
    targetOrder = orderId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${targetShop}/orders/${targetOrder}/start-preparing`)
      .set('Authorization', 'Bearer session')
      .send(body);
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'] as const)(
    'allows %s to start once with saved server time and attribution',
    async (staffRole) => {
      await preparePending();
      await atomic().expect(200);
      const paid = JSON.stringify({
        paidAt: saved.paidAt,
        paidBy: saved.paidBy,
        amountReceived: saved.amountReceived,
        queuedAt: saved.queuedAt,
      });
      role = staffRole;
      updateOrder.mockClear();
      const first = await start().expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body.alreadyStarted).toBe(false);
      expect(first.body.order).toMatchObject({
        id: orderId,
        shopId,
        preparationStatus: 'PREPARING',
        preparationStartedBy: userId,
      });
      expect(
        Date.parse(first.body.order.preparationStartedAt),
      ).toBeGreaterThanOrEqual(saved.queuedAt!.getTime());
      const replay = await start().expect(200);
      expect(replay.body).toEqual({
        order: first.body.order,
        alreadyStarted: true,
      });
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify({
          paidAt: saved.paidAt,
          paidBy: saved.paidBy,
          amountReceived: saved.amountReceived,
          queuedAt: saved.queuedAt,
        }),
      ).toBe(paid);
      const preparing = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/preparing`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(preparing.body.orders[0]).toMatchObject(first.body.order);
      const queued = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/queue`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(queued.body.orders).toEqual([]);
    },
  );
  it('denies cashier, anonymous, revoked and foreign resource preparation starts', async () => {
    await start().expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/start-preparing`)
      .send({})
      .expect(401);
    role = 'KITCHEN';
    await start({}, shopId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(404);
    await start({}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(404);
    active = false;
    await start().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([
    { preparationStartedAt: '2020-01-01' },
    { preparationStartedBy: 'forged' },
    { preparationStatus: 'READY' },
  ])('rejects client preparation fields %j', async (body) => {
    role = 'KITCHEN';
    await start(body).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each(['PENDING_CONFIRMATION', 'REJECTED', 'UNPAID', 'READY'])(
    'cannot start ineligible work: %s',
    async (state) => {
      await preparePending();
      await atomic().expect(200);
      role = 'KITCHEN';
      updateOrder.mockClear();
      if (state === 'UNPAID') saved.paymentStatus = state;
      else if (state === 'READY') saved.preparationStatus = state;
      else saved.status = state;
      await start().expect(409);
      expect(updateOrder).not.toHaveBeenCalled();
    },
  );
  it('excludes unpaid orders and rejects malformed queue cursors', async () => {
    role = 'KITCHEN';
    const path = `/api/v1/shops/${shopId}/preparation/queue`;
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer session')
      .expect(200);
    expect(response.body).toEqual({ orders: [], nextCursor: null });
    await request(app.getHttpServer())
      .get(path)
      .query({ cursor: 'invalid' })
      .set('Authorization', 'Bearer session')
      .expect(400);
  });
  const ready = (
    body: Record<string, unknown> = {},
    targetShop = shopId,
    targetOrder = orderId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${targetShop}/orders/${targetOrder}/mark-ready`)
      .set('Authorization', 'Bearer session')
      .send(body);
  async function preparingOrder() {
    await preparePending();
    await atomic().expect(200);
    role = 'KITCHEN';
    await start().expect(200);
    updateOrder.mockClear();
  }
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'] as const)(
    'allows %s to mark preparing orders ready exactly once',
    async (staffRole) => {
      await preparingOrder();
      role = staffRole;
      const before = JSON.stringify({
        queuedAt: saved.queuedAt,
        preparationStartedAt: saved.preparationStartedAt,
        preparationStartedBy: saved.preparationStartedBy,
        paidAt: saved.paidAt,
        paidBy: saved.paidBy,
        amountReceived: saved.amountReceived,
      });
      const first = await ready().expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body).toMatchObject({
        alreadyReady: false,
        order: {
          id: orderId,
          shopId,
          preparationStatus: 'READY',
          preparationReadyBy: userId,
        },
      });
      expect(
        Date.parse(first.body.order.preparationReadyAt),
      ).toBeGreaterThanOrEqual(saved.preparationStartedAt!.getTime());
      expect((await ready().expect(200)).body).toEqual({
        order: first.body.order,
        alreadyReady: true,
      });
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify({
          queuedAt: saved.queuedAt,
          preparationStartedAt: saved.preparationStartedAt,
          preparationStartedBy: saved.preparationStartedBy,
          paidAt: saved.paidAt,
          paidBy: saved.paidBy,
          amountReceived: saved.amountReceived,
        }),
      ).toBe(before);
      const readyList = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/ready`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(readyList.body.orders).toHaveLength(1);
      expect(readyList.body.orders[0]).toMatchObject(first.body.order);
      expect(readyList.body.orders[0]).not.toHaveProperty('paymentReference');
      const preparing = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/preparing`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(preparing.body.orders).toEqual([]);
      await start().expect(409);
    },
  );
  it.each([
    'QUEUED',
    'PENDING_CONFIRMATION',
    'REJECTED',
    'UNPAID',
    'MISSING_START',
    'COMPLETED',
  ])('cannot mark ineligible orders ready: %s', async (state) => {
    await preparingOrder();
    if (state === 'UNPAID') saved.paymentStatus = state;
    else if (['QUEUED', 'COMPLETED'].includes(state))
      saved.preparationStatus = state;
    else if (state === 'MISSING_START') saved.preparationStartedAt = null;
    else saved.status = state;
    await ready().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects unauthorized, revoked and foreign ready actions', async () => {
    await preparingOrder();
    role = 'CASHIER';
    await ready().expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/mark-ready`)
      .send({})
      .expect(401);
    role = 'KITCHEN';
    await ready({}, shopId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(404);
    await ready({}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(404);
    active = false;
    await ready().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([
    { preparationReadyAt: '2020-01-01' },
    { preparationReadyBy: 'forged' },
    { preparationStatus: 'READY' },
  ])('rejects forged ready fields %j', async (body) => {
    await preparingOrder();
    await ready(body).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects a stale conditional ready write', async () => {
    await preparingOrder();
    updateOrder.mockResolvedValueOnce({ count: 0 });
    await ready().expect(409);
    expect(saved.preparationStatus).toBe('PREPARING');
    expect(saved.preparationReadyAt).toBeNull();
  });
  const complete = (
    body: Record<string, unknown> = {},
    targetShop = shopId,
    targetOrder = orderId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/shops/${targetShop}/orders/${targetOrder}/complete`)
      .set('Authorization', 'Bearer session')
      .send(body);
  async function readyOrder() {
    await preparingOrder();
    await ready().expect(200);
    updateOrder.mockClear();
  }
  const sales = (
    from = '2020-01-01T00:00:00.000Z',
    to = '2020-01-02T00:00:00.000Z',
    targetShop = shopId,
  ) =>
    request(app.getHttpServer())
      .get(`/api/v1/shops/${targetShop}/reports/completed-sales`)
      .query({ from, to })
      .set('Authorization', 'Bearer session');
  it.each(['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'] as const)(
    'allows %s to complete a ready order once without changing paid or preparation records',
    async (staffRole) => {
      await readyOrder();
      role = staffRole;
      const before = JSON.stringify({
        queuedAt: saved.queuedAt,
        startAt: saved.preparationStartedAt,
        startBy: saved.preparationStartedBy,
        readyAt: saved.preparationReadyAt,
        readyBy: saved.preparationReadyBy,
        paidAt: saved.paidAt,
        paidBy: saved.paidBy,
        total: saved.totalPrice,
      });
      const first = await complete().expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body).toMatchObject({
        alreadyCompleted: false,
        order: {
          id: orderId,
          shopId,
          preparationStatus: 'COMPLETED',
          completedBy: userId,
        },
      });
      expect(Date.parse(first.body.order.completedAt)).toBeGreaterThanOrEqual(
        saved.preparationReadyAt!.getTime(),
      );
      expect((await complete().expect(200)).body).toEqual({
        order: first.body.order,
        alreadyCompleted: true,
      });
      expect(updateOrder).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify({
          queuedAt: saved.queuedAt,
          startAt: saved.preparationStartedAt,
          startBy: saved.preparationStartedBy,
          readyAt: saved.preparationReadyAt,
          readyBy: saved.preparationReadyBy,
          paidAt: saved.paidAt,
          paidBy: saved.paidBy,
          total: saved.totalPrice,
        }),
      ).toBe(before);
      const history = await request(app.getHttpServer())
        .get(`/api/v1/shops/${shopId}/preparation/completed`)
        .set('Authorization', 'Bearer session')
        .expect(200);
      expect(history.body.orders[0]).toMatchObject(first.body.order);
      for (const state of ['queue', 'preparing', 'ready'])
        expect(
          (
            await request(app.getHttpServer())
              .get(`/api/v1/shops/${shopId}/preparation/${state}`)
              .set('Authorization', 'Bearer session')
              .expect(200)
          ).body.orders,
        ).toEqual([]);
      await start().expect(409);
      await ready().expect(409);
    },
  );
  it.each([
    'QUEUED',
    'PREPARING',
    'PENDING_CONFIRMATION',
    'REJECTED',
    'UNPAID',
    'MISSING_READY',
  ])('cannot complete ineligible work %s', async (state) => {
    await readyOrder();
    if (state === 'UNPAID') saved.paymentStatus = state;
    else if (['QUEUED', 'PREPARING'].includes(state))
      saved.preparationStatus = state;
    else if (state === 'MISSING_READY') saved.preparationReadyAt = null;
    else saved.status = state;
    await complete().expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects unauthorized, revoked and foreign completion actions', async () => {
    await readyOrder();
    role = 'CASHIER';
    await complete().expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/shops/${shopId}/orders/${orderId}/complete`)
      .send({})
      .expect(401);
    role = 'KITCHEN';
    await complete({}, shopId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(
      404,
    );
    await complete({}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').expect(404);
    active = false;
    await complete().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it.each([
    { completedAt: '2020-01-01' },
    { completedBy: 'forged' },
    { preparationStatus: 'COMPLETED' },
  ])('rejects forged completion fields %j', async (body) => {
    await readyOrder();
    await complete(body).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects a stale conditional completion write', async () => {
    await readyOrder();
    updateOrder.mockResolvedValueOnce({ count: 0 });
    await complete().expect(409);
    expect(saved.preparationStatus).toBe('READY');
    expect(saved.completedAt).toBeNull();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
    'allows %s final sales metrics with inclusive/exclusive completion boundaries',
    async (reportRole) => {
      await readyOrder();
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      role = reportRole;
      expect((await sales(from, to).expect(200)).body).toMatchObject({
        completedOrders: 0,
        totalSales: '0.00',
      });
      await complete().expect(200);
      const completedAt = saved.completedAt!.toISOString();
      expect((await sales(completedAt, to).expect(200)).body).toMatchObject({
        currency: 'PHP',
        completedOrders: 1,
        totalSales: '135.50',
      });
      await complete().expect(200);
      expect((await sales(completedAt, to).expect(200)).body).toMatchObject({
        completedOrders: 1,
        totalSales: '135.50',
      });
      expect((await sales(from, completedAt).expect(200)).body).toMatchObject({
        completedOrders: 0,
        totalSales: '0.00',
      });
      expect(aggregateOrders.mock.calls.at(-1)![0].where).toMatchObject({
        shopId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        preparationStatus: 'COMPLETED',
        currency: 'PHP',
      });
    },
  );
  it.each(['CASHIER', 'KITCHEN'] as const)(
    'denies %s sales metrics',
    async (reportRole) => {
      role = reportRole;
      await sales().expect(403);
      expect(aggregateOrders).not.toHaveBeenCalled();
    },
  );
  it('excludes rejected history from sales and leaves its captured decision unchanged', async () => {
    role = 'OWNER';
    Object.assign(saved, {
      status: 'REJECTED',
      paymentStatus: 'UNPAID',
      preparationStatus: null,
      decidedAt: new Date(),
      decidedBy: userId,
      rejectionReason: 'Customer declined alternative.',
    });
    const before = JSON.stringify(saved);
    expect((await sales().expect(200)).body).toMatchObject({
      completedOrders: 0,
      totalSales: '0.00',
    });
    expect(JSON.stringify(saved)).toBe(before);
    expect(updateOrder).not.toHaveBeenCalled();
    expect(aggregateOrders.mock.calls.at(-1)![0].where).toMatchObject({
      shopId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      preparationStatus: 'COMPLETED',
      completedBy: { not: null },
      currency: 'PHP',
    });
  });
  it('does not count a negative status even if stale paid/completed metadata is present', async () => {
    await readyOrder();
    await complete().expect(200);
    role = 'OWNER';
    saved.status = 'REJECTED';
    expect((await sales().expect(200)).body).toMatchObject({
      completedOrders: 0,
      totalSales: '0.00',
    });
  });
  it('denies anonymous, missing-membership and revoked sales-report access before aggregation', async () => {
    role = 'OWNER';
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/reports/completed-sales`)
      .query({ from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' })
      .expect(401);
    membership.mockResolvedValueOnce(null);
    await sales().expect(404);
    active = false;
    await sales().expect(404);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { from: '2026-10-15T00:00:00Z' },
    {
      from: ['2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z'],
      to: '2026-10-17T00:00:00Z',
    },
    { from: '2026-02-30T00:00:00Z', to: '2026-03-02T00:00:00Z' },
    { from: '2026-10-15T00:00:00Z\n', to: '2026-10-16T00:00:00Z' },
    { from: '2026-10-15T00:00:00+08:00', to: '2026-10-16T00:00:00Z' },
  ])('fails closed for malformed report parameters %j', async (query) => {
    role = 'OWNER';
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/reports/completed-sales`)
      .query(query)
      .set('Authorization', 'Bearer session')
      .expect(400);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it.each([
    ['bad', '2026-01-02T00:00:00Z'],
    ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    ['2026-01-01', '2026-01-02'],
  ])('rejects invalid sales period %s / %s', async (from, to) => {
    role = 'OWNER';
    await sales(from, to).expect(400);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it('requires manual attestation and appropriate fields for combined payment', async () => {
    await preparePending();
    await atomic('GCASH_MANUAL', { receivedConfirmed: false }).expect(400);
    await atomic('CARD_MANUAL', { amountReceived: '1.00' }).expect(400);
    await atomic('OTHER', { description: '' }).expect(400);
    await atomic('CASH', { receivedConfirmed: true }).expect(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rejects mixed/missing references and stale confirmation review', async () => {
    await preparePending();
    await atomic('CASH', { orderNumber: saved.orderNumber }).expect(400);
    await atomic('CASH', { qrToken: undefined }).expect(400);
    await atomic('CASH', { reviewVersion: 'b'.repeat(64) }).expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('validates signed QR but permits explicit number fallback after expiry', async () => {
    await preparePending();
    saved.qrTokenExpiresAt = new Date(0);
    await atomic().expect(403);
    await atomic('CASH', {}, true).expect(200);
  });
  it('does not accept an unchecked QR to create payment on a historical confirmed order', async () => {
    await atomic('CASH', { qrToken: 'arbitrary-token' }).expect(409);
    expect(updateOrder).not.toHaveBeenCalled();
    expect(saved.paymentStatus).toBe('UNPAID');
    await collect().expect(200);
  });
  it.each([
    '4111111111111111',
    '4111.1111.1111.1111',
    '4111/1111/1111/1111',
    '４１１１ １１１１ １１１１ １１１１',
    '٤١١١ ١١١١ ١١١١ ١١١١',
    'CVV: 123',
    'PIN: 1234',
    'expiry: 12/28',
  ])(
    'blocks card data in manual card reference before persistence: %s',
    async (reference) => {
      await card({ reference }).expect(400);
      expect(updateOrder).not.toHaveBeenCalled();
      await preparePending();
      await atomic('CARD_MANUAL', { reference }).expect(400);
      expect(saved.status).toBe('PENDING_CONFIRMATION');
      expect(saved.paymentStatus).toBe('UNPAID');
      expect(saved.preparationStatus).toBeNull();
    },
  );
  it('enforces authentication, tenant and live access for combined payment', async () => {
    await preparePending();
    await atomic('CASH', {}, false, shopId, false).expect(401);
    await atomic(
      'CASH',
      {},
      false,
      '55b18d73-f2fb-4fe6-bb1c-30cf385c3b24',
    ).expect(404);
    role = 'KITCHEN';
    await atomic().expect(403);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('rechecks combined-payment access inside the transaction', async () => {
    await preparePending();
    raw.mockImplementationOnce(async () => {
      role = 'KITCHEN';
      return [];
    });
    await atomic().expect(404);
    expect(updateOrder).not.toHaveBeenCalled();
  });
  it('cannot reuse a combined request with changed payment details', async () => {
    await preparePending();
    await atomic().expect(200);
    await atomic('CASH', { amountReceived: '300.00' }).expect(409);
    await atomic('GCASH_MANUAL').expect(409);
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });
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
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves daily gross sales for %s with an explicit Manila period', async (reportRole) => {
    role = reportRole;
    const recent = { id: orderId, shopId, orderNumber: 'ORD-000042', status: 'CONFIRMED', paymentStatus: 'PAID', preparationStatus: 'COMPLETED', currency: 'PHP', totalPrice: new Prisma.Decimal('0.10'), completedAt: new Date('2026-10-16T00:05:00.000Z') };
    findQueue.mockResolvedValueOnce([recent]);
    aggregateOrders.mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { totalPrice: new Prisma.Decimal('0.30') } });
    const result = await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/reports/daily-sales`)
      .query({ date: '2026-10-16' })
      .set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({ shopId, businessDate: '2026-10-16', timezone: 'Asia/Manila', from: '2026-10-15T16:00:00.000Z', to: '2026-10-16T16:00:00.000Z', currency: 'PHP', completedOrders: 2, totalSales: '0.30', itemsSold: 7, recentOrders: [{ ...recent, totalPrice: '0.10', completedAt: '2026-10-16T00:05:00.000Z' }], paymentBreakdown: [
      { paymentMethod: 'CASH', orders: 2, totalSales: '0.30' },
      { paymentMethod: 'GCASH_MANUAL', orders: 0, totalSales: '0.00' },
      { paymentMethod: 'CARD_MANUAL', orders: 0, totalSales: '0.00' },
      { paymentMethod: 'OTHER', orders: 0, totalSales: '0.00' },
    ] });
    expect(aggregateOrders).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId, status: 'CONFIRMED', paymentStatus: 'PAID', preparationStatus: 'COMPLETED', completedAt: { gte: new Date('2026-10-15T16:00:00.000Z'), lt: new Date('2026-10-16T16:00:00.000Z') } }) }));
  });
  it.each(['KITCHEN', 'CASHIER'] as const)('denies daily sales for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-sales`).query({ date: '2026-10-16' }).set('Authorization', 'Bearer session').expect(403);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it('rejects missing or invalid daily dates and anonymous report access', async () => {
    role = 'OWNER';
    for (const query of [{}, { date: '2026-02-30' }, { date: ['2026-10-15', '2026-10-16'] }]) {
      await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-sales`).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-sales`).query({ date: '2026-10-16' }).expect(401);
    active = false;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-sales`).query({ date: '2026-10-16' }).set('Authorization', 'Bearer session').expect(404);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it('rejects daily report access revoked after the guard, before reading metrics', async () => {
    role = 'OWNER';
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-sales`).query({ date: '2026-10-16' }).set('Authorization', 'Bearer session').expect(404);
    expect(aggregateOrders).not.toHaveBeenCalled();
    expect(aggregateItems).not.toHaveBeenCalled();
    expect(groupPayments).not.toHaveBeenCalled();
  });
  it('rejects a daily report for another shop even when membership resolution is stale', async () => {
    role = 'OWNER';
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/daily-sales').query({ date: '2026-10-16' }).set('Authorization', 'Bearer session').expect(404);
    expect(aggregateOrders).not.toHaveBeenCalled();
    expect(aggregateItems).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves daily range analytics for %s', async (reportRole) => {
    role = reportRole;
    raw.mockResolvedValueOnce([]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-analytics`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-16' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.days).toEqual([
      { businessDate: '2026-10-15', totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
      { businessDate: '2026-10-16', totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
    ]);
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies daily analytics for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-analytics`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-16' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid daily analytics queries and anonymous access', async () => {
    role = 'OWNER';
    const route = `/api/v1/shops/${shopId}/reports/daily-analytics`;
    for (const query of [{}, { startDate: ['2026-10-15', '2026-10-16'], endDate: '2026-10-16' }, { startDate: '2026-10-17', endDate: '2026-10-16' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query({ startDate: '2026-10-16', endDate: '2026-10-16' }).expect(401);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects access lost between the daily analytics guard and transaction', async () => {
    role = 'OWNER';
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/daily-analytics`)
      .query({ startDate: '2026-10-16', endDate: '2026-10-16' }).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves consistent weekly analytics for %s', async (reportRole) => {
    role = reportRole;
    raw.mockResolvedValueOnce([]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/weekly-analytics`)
      .query({ startDate: '2026-10-18', endDate: '2026-10-19' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.weekStartsOn).toBe('MONDAY');
    expect(result.body.weeks).toEqual([
      { weekStart: '2026-10-12', weekEnd: '2026-10-18', fromDate: '2026-10-18', toDate: '2026-10-18', partial: true, totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
      { weekStart: '2026-10-19', weekEnd: '2026-10-25', fromDate: '2026-10-19', toDate: '2026-10-19', partial: true, totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
    ]);
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies weekly analytics for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/weekly-analytics`)
      .query({ startDate: '2026-10-18', endDate: '2026-10-19' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid weekly queries, anonymous, foreign-shop and revoked access', async () => {
    role = 'OWNER';
    const route = `/api/v1/shops/${shopId}/reports/weekly-analytics`;
    const period = { startDate: '2026-10-18', endDate: '2026-10-19' };
    for (const query of [{}, { startDate: ['2026-10-18', '2026-10-19'], endDate: '2026-10-19' }, { startDate: '2026-10-20', endDate: '2026-10-19' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/weekly-analytics').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves calendar-month analytics for %s', async (reportRole) => {
    role = reportRole;
    raw.mockResolvedValueOnce([]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/monthly-analytics`)
      .query({ startDate: '2028-02-29', endDate: '2028-03-01' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.aggregation).toBe('CALENDAR_MONTH');
    expect(result.body.months).toEqual([
      { month: '2028-02', monthStart: '2028-02-01', monthEnd: '2028-02-29', fromDate: '2028-02-29', toDate: '2028-02-29', partial: true, totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
      { month: '2028-03', monthStart: '2028-03-01', monthEnd: '2028-03-31', fromDate: '2028-03-01', toDate: '2028-03-01', partial: true, totalSales: '0.00', completedOrders: 0, itemsSold: 0 },
    ]);
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies monthly analytics for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/monthly-analytics`)
      .query({ startDate: '2026-10-01', endDate: '2026-10-31' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid monthly queries, anonymous, foreign-shop and revoked access', async () => {
    role = 'OWNER';
    const route = `/api/v1/shops/${shopId}/reports/monthly-analytics`;
    const period = { startDate: '2026-10-01', endDate: '2026-10-31' };
    for (const query of [{}, { startDate: ['2026-10-01', '2026-10-02'], endDate: '2026-10-31' }, { startDate: '2026-11-01', endDate: '2026-10-31' }, { startDate: '2026-01-01', endDate: '2027-01-02' }, { startDate: '2026-02-29', endDate: '2026-03-01' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/monthly-analytics').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves one consistent custom period for %s', async (reportRole) => {
    role = reportRole;
    aggregateOrders.mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { totalPrice: new Prisma.Decimal('0.30') } });
    findQueue.mockResolvedValueOnce([]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/custom-sales`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ shopId, startDate: '2026-10-15', endDate: '2026-10-17', from: '2026-10-14T16:00:00.000Z', to: '2026-10-17T16:00:00.000Z', totalSales: '0.30', completedOrders: 2, itemsSold: 7, recentOrders: [] });
    expect(result.body.paymentBreakdown[0]).toEqual({ paymentMethod: 'CASH', orders: 2, totalSales: '0.30' });
    expect(groupPayments.mock.calls[0][0].where).toEqual(aggregateOrders.mock.calls[0][0].where);
    expect(findQueue.mock.calls[0][0].where).toEqual(aggregateOrders.mock.calls[0][0].where);
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies custom sales for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/custom-sales`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(403);
    expect(aggregateOrders).not.toHaveBeenCalled();
  });
  it('rejects invalid custom periods, anonymous, foreign shop and revoked access', async () => {
    role = 'OWNER';
    const route = `/api/v1/shops/${shopId}/reports/custom-sales`;
    const period = { startDate: '2026-10-15', endDate: '2026-10-17' };
    for (const query of [{}, { startDate: ['2026-10-15', '2026-10-16'], endDate: '2026-10-17' }, { startDate: '2026-10-18', endDate: '2026-10-17' }, { startDate: '2026-01-01', endDate: '2027-01-02' }, { startDate: '2026-02-29', endDate: '2026-03-01' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/custom-sales').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(aggregateOrders).not.toHaveBeenCalled(); expect(aggregateItems).not.toHaveBeenCalled(); expect(groupPayments).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves snapshot product ranking for %s', async (reportRole) => {
    role = reportRole;
    for (const metric of ['QUANTITY', 'REVENUE']) {
      raw.mockResolvedValueOnce([]);
      const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/top-products`)
        .query({ startDate: '2026-10-15', endDate: '2026-10-17', metric }).set('Authorization', 'Bearer session').expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toMatchObject({ shopId, startDate: '2026-10-15', endDate: '2026-10-17', metric, totalQuantity: 0, totalRevenue: '0.00', products: [], limit: 10 });
    }
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies product ranking for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/top-products`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17', metric: 'QUANTITY' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid product queries, anonymous, foreign-shop and revoked access', async () => {
    role = 'OWNER'; const route = `/api/v1/shops/${shopId}/reports/top-products`;
    const period = { startDate: '2026-10-15', endDate: '2026-10-17', metric: 'QUANTITY' };
    for (const query of [{}, { ...period, metric: 'PRICE' }, { ...period, metric: ['QUANTITY', 'REVENUE'] }, { ...period, startDate: ['2026-10-15', '2026-10-16'] }, { ...period, startDate: '2026-10-18' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/top-products').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves 24 Manila completion-hour buckets for %s', async (reportRole) => {
    role = reportRole; raw.mockResolvedValueOnce([]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/peak-hours`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ shopId, startDate: '2026-10-15', endDate: '2026-10-17', from: '2026-10-14T16:00:00.000Z', to: '2026-10-17T16:00:00.000Z', timeBasis: 'COMPLETED_AT', timezone: 'Asia/Manila', completedOrders: 0, totalSales: '0.00', peakHours: [] });
    expect(result.body.hours).toEqual(Array.from({ length: 24 }, (_, hour) => ({ hour, completedOrders: 0, totalSales: '0.00' })));
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies Peak Hours for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/peak-hours`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid peak-hour queries, anonymous, foreign shop and revoked access', async () => {
    role = 'OWNER'; const route = `/api/v1/shops/${shopId}/reports/peak-hours`;
    const period = { startDate: '2026-10-15', endDate: '2026-10-17' };
    for (const query of [{}, { ...period, startDate: ['2026-10-15', '2026-10-16'] }, { ...period, startDate: '2026-10-18' }, { startDate: '2026-02-29', endDate: '2026-03-01' }, { startDate: '2026-01-01', endDate: '2027-01-02' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/peak-hours').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
  });
  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)('serves preparation duration and sample coverage for %s', async (reportRole) => {
    role = reportRole;
    raw.mockResolvedValueOnce([{ eligibleOrders: 2n, measuredOrders: 1n, missingTimestamps: 1n, invalidTimestamps: 0n, totalDurationMs: '120000' }]);
    const result = await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/average-prep-time`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ shopId, startDate: '2026-10-15', endDate: '2026-10-17', from: '2026-10-14T16:00:00.000Z', to: '2026-10-17T16:00:00.000Z', durationBasis: 'PREPARING_TO_READY', selectionBasis: 'COMPLETED_AT', eligibleOrders: 2, measuredOrders: 1, excludedOrders: 1, missingTimestamps: 1, invalidTimestamps: 0, totalDurationMs: '120000', averageDurationMs: 120000 });
  });
  it.each(['CASHIER', 'KITCHEN'] as const)('denies average preparation reporting for %s', async (reportRole) => {
    role = reportRole;
    await request(app.getHttpServer()).get(`/api/v1/shops/${shopId}/reports/average-prep-time`)
      .query({ startDate: '2026-10-15', endDate: '2026-10-17' }).set('Authorization', 'Bearer session').expect(403);
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects invalid prep-report dates, anonymous, foreign shop and revoked access', async () => {
    role = 'OWNER'; const route = `/api/v1/shops/${shopId}/reports/average-prep-time`;
    const period = { startDate: '2026-10-15', endDate: '2026-10-17' };
    for (const query of [{}, { ...period, startDate: ['2026-10-15', '2026-10-16'] }, { ...period, startDate: '2026-10-18' }, { startDate: '2026-02-29', endDate: '2026-03-01' }, { startDate: '2026-01-01', endDate: '2027-01-02' }]) {
      await request(app.getHttpServer()).get(route).query(query).set('Authorization', 'Bearer session').expect(400);
    }
    await request(app.getHttpServer()).get(route).query(period).expect(401);
    await request(app.getHttpServer()).get('/api/v1/shops/55b18d73-f2fb-4fe6-bb1c-30cf385c3b24/reports/average-prep-time').query(period).set('Authorization', 'Bearer session').expect(404);
    transaction.mockImplementationOnce(async (work) => { role = 'CASHIER'; return work(database); });
    await request(app.getHttpServer()).get(route).query(period).set('Authorization', 'Bearer session').expect(404);
    expect(raw).not.toHaveBeenCalled();
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
  it('passes completed history filters through the authorized route to the scoped query', async () => {
    role = 'KITCHEN';
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/preparation/completed`)
      .query({
        limit: '12',
        search: '000042',
        from: '2026-10-14T00:00:00.000Z',
        to: '2026-10-16T00:00:00.000Z',
      })
      .set('Authorization', 'Bearer session')
      .expect(200);
    expect(findQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 13,
        where: expect.objectContaining({
          shopId,
          preparationStatus: 'COMPLETED',
          orderNumber: { contains: '000042' },
          completedAt: {
            not: null,
            gte: new Date('2026-10-14T00:00:00.000Z'),
            lt: new Date('2026-10-16T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
  it.each([
    { limit: '999' },
    { search: '%' },
    { from: '2026-02-30T00:00:00.000Z' },
    { from: 'invalid' },
  ])('rejects invalid completed history queries: %j', async (query) => {
    role = 'KITCHEN';
    await request(app.getHttpServer())
      .get(`/api/v1/shops/${shopId}/preparation/completed`)
      .query(query)
      .set('Authorization', 'Bearer session')
      .expect(400);
    expect(findQueue).not.toHaveBeenCalled();
  });
});
