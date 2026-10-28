// Real services and migrations, only inside the disposable local PostgreSQL runner.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { CashPaymentService } from '../dist/modules/orders/cash-payment.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';
import { PublicProductService } from '../dist/modules/products/public-product.service.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { TokensService } from '../dist/modules/auth/tokens.service.js';
import { ApiCapacityService } from '../dist/common/load-shedding/api-capacity.service.js';
import { RequestDeadlineService } from '../dist/common/http/request-deadline.service.js';

const url = process.env.DATABASE_URL;
assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    url &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname),
  'Run test:idempotency:postgres; hosted targets are refused.',
);
const setup = new pg.Client({ connectionString: url });
const primary = new PrismaService(),
  replica = new PrismaService();
const config = new ConfigService();
const tokens = new OrderTokenService(config),
  contexts = new TableContextService(config);
const orders = [primary, replica].map(
  (db) =>
    new OrdersService(
      db,
      new PublicProductService(new PublicProductRepository(db)),
      contexts,
      tokens,
    ),
);
const cash = [primary, replica].map(
  (db) => new CashPaymentService(db, new OrderQrService(db, tokens)),
);
const results = [];
let app;
const check = async (name, run) => {
  const start = performance.now();
  await run();
  results.push({
    name,
    pass: true,
    elapsedMs: Math.round(performance.now() - start),
  });
};
const retry = async (work) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        attempt >= 11 ||
        !['ORDER_RETRY_REQUIRED', 'CASH_PAYMENT_CONFLICT'].includes(
          error.getResponse?.().code,
        )
      )
        throw error;
      await delay(15 + Math.floor(Math.random() * 30));
    }
  }
};
const concurrent = async (jobs) => {
  const outcomes = await Promise.allSettled(jobs.map((work) => retry(work)));
  const failed = outcomes.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return outcomes.map((result) => result.value);
};
await setup.connect();
try {
  // Minimal local platform shims allow the *unaltered* application migrations.
  // Broadcasts are transactional rows here; no Supabase service is contacted.
  await setup.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages (topic text, event text, payload jsonb, private boolean);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS
    $$ INSERT INTO realtime.messages(payload,event,topic,private) VALUES ($1,$2,$3,$4) $$;`);
  const migrations = (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((name) => /^\d/.test(name))
    .sort();
  const latest = '20261028090000_idempotency_key_identity';
  for (const name of migrations.filter((name) => name !== latest)) {
    await setup.query(
      await readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      ),
    );
  }
  const migration = await readFile(
    new URL(`../prisma/migrations/${latest}/migration.sql`, import.meta.url),
    'utf8',
  );
  const users = await Promise.all(
    [0, 1].map((number) =>
      primary.user.create({
        data: {
          email: `cashier-${number}@idempotency.example.invalid`,
          passwordHash: 'fixture-only-no-login',
        },
      }),
    ),
  );
  const shops = await Promise.all(
    [0, 1].map((number) =>
      primary.shop.create({
        data: {
          name: `Idempotency fixture ${number}`,
          slug: `idempotency-fixture-${number}`,
        },
      }),
    ),
  );
  for (const shop of shops)
    for (const user of users)
      await primary.shopMember.create({
        data: {
          userId: user.id,
          shopId: shop.id,
          role: 'CASHIER',
        },
      });
  const products = await Promise.all(
    shops.map((shop) =>
      primary.product.create({
        data: {
          shopId: shop.id,
          name: 'Fixture coffee',
          slug: 'fixture-coffee',
          price: '10.00',
        },
      }),
    ),
  );
  const body = (shop = 0, requestId = randomUUID()) => ({
    requestId,
    mode: 'TAKEOUT',
    reviewedTotal: '10.00',
    items: [
      {
        productId: products[shop].id,
        quantity: 1,
        variantIds: [],
        addOnIds: [],
      },
    ],
  });
  const submit = (request = body(), shop = 0, instance = 0) =>
    orders[instance].create(shops[shop].slug, request);
  const paymentDto = async (
    order,
    method = 'CASH',
    requestId = randomUUID(),
    shop = 0,
  ) => ({
    requestId,
    method,
    orderNumber: order.orderNumber,
    reviewVersion: (
      await cash[0].review(users[0].id, shops[shop].id, order.id, primary, true)
    ).order.reviewVersion,
    ...(method === 'CASH'
      ? { amountReceived: '20.00' }
      : { receivedConfirmed: true }),
    ...(method === 'OTHER' ? { description: 'Fixture voucher' } : {}),
  });
  const pay = (order, dto, instance = 0, user = 0, shop = 0) =>
    cash[instance].create(users[user].id, shops[shop].id, order.id, dto);
  const count = (requestId, shop = 0) =>
    primary.order.count({
      where: {
        shopId: shops[shop].id,
        requestId: { equals: requestId.toLowerCase(), mode: 'insensitive' },
      },
    });
  const legacyBody = body();
  const legacy = (await submit(legacyBody)).order;
  let alias;
  await check(
    'migration-refuses-existing-order-key-aliases-without-partial-install',
    async () => {
      const original = await primary.order.findUniqueOrThrow({
        where: { id: legacy.id },
      });
      alias = await primary.order.create({
        data: {
          ...original,
          id: randomUUID(),
          orderNumber: 'ORD-900001',
          requestId: legacyBody.requestId.toUpperCase(),
        },
      });
      await assert.rejects(
        setup.query(migration),
        (error) => error.code === '23505',
      );
      await setup.query('ROLLBACK');
      assert.equal(
        (
          await setup.query(
            "SELECT to_regclass('orders_shop_request_id_identity_key') AS name",
          )
        ).rows[0].name,
        null,
      );
      await primary.order.delete({ where: { id: alias.id } });
      await setup.query('UPDATE orders SET "requestId" = $1 WHERE id = $2', [
        legacyBody.requestId.toUpperCase(),
        legacy.id,
      ]);
    },
  );
  const historicalBody = body();
  const historicalOrder = (await submit(historicalBody)).order;
  const historicalDto = await paymentDto(historicalOrder);
  await pay(historicalOrder, historicalDto);
  await check(
    'migration-refuses-existing-payment-key-aliases-without-partial-install',
    async () => {
      const paid = await primary.order.findUniqueOrThrow({
        where: { id: historicalOrder.id },
      });
      alias = await primary.order.create({
        data: {
          ...paid,
          id: randomUUID(),
          requestId: randomUUID(),
          orderNumber: 'ORD-900002',
          paymentRequestId: paid.paymentRequestId.toUpperCase(),
        },
      });
      await assert.rejects(
        setup.query(migration),
        (error) => error.code === '23505',
      );
      await setup.query('ROLLBACK');
      assert.equal(
        (
          await setup.query(
            "SELECT to_regclass('orders_shop_request_id_identity_key') AS name",
          )
        ).rows[0].name,
        null,
      );
      await primary.order.delete({ where: { id: alias.id } });
    },
  );
  await setup.query(migration);
  await check(
    'mixed-case-and-historical-order-keys-replay-one-saved-order',
    async () => {
      assert.deepEqual((await submit(legacyBody, 0, 1)).order, legacy);
      assert.deepEqual(
        (
          await submit({
            ...legacyBody,
            requestId: legacyBody.requestId.toUpperCase(),
          })
        ).order,
        legacy,
      );
      assert.equal(await count(legacyBody.requestId), 1);
    },
  );
  let concurrentBody, concurrentOrder;
  await check(
    'eight-concurrent-order-retries-across-two-clients-commit-once',
    async () => {
      concurrentBody = body();
      const before = (
        await primary.shop.findUniqueOrThrow({ where: { id: shops[0].id } })
      ).lastOrderNumber;
      const beforeBroadcast = (
        await setup.query(
          "SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1 AND event = 'new_order'",
          [`staff:new-order:${shops[0].id}:cashier`],
        )
      ).rows[0].n;
      const replies = await concurrent(
        Array.from(
          { length: 8 },
          (_, index) => () =>
            submit(
              {
                ...concurrentBody,
                requestId:
                  index % 2
                    ? concurrentBody.requestId.toUpperCase()
                    : concurrentBody.requestId,
              },
              0,
              index % 2,
            ),
        ),
      );
      concurrentOrder = replies[0].order;
      replies.forEach((reply) =>
        assert.deepEqual(reply.order, concurrentOrder),
      );
      assert.equal(await count(concurrentBody.requestId), 1);
      assert.equal(
        await primary.orderItem.count({
          where: { shopId: shops[0].id, orderId: concurrentOrder.id },
        }),
        1,
      );
      assert.equal(
        (await primary.shop.findUniqueOrThrow({ where: { id: shops[0].id } }))
          .lastOrderNumber - before,
        1n,
      );
      assert.equal(
        (
          await setup.query(
            "SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1 AND event = 'new_order'",
            [`staff:new-order:${shops[0].id}:cashier`],
          )
        ).rows[0].n - beforeBroadcast,
        1,
      );
    },
  );
  await check(
    'changed-order-payload-cannot-reuse-a-committed-key',
    async () => {
      await assert.rejects(
        submit({
          ...concurrentBody,
          reviewedTotal: '20.00',
          items: [{ ...concurrentBody.items[0], quantity: 2 }],
        }),
        (error) => error.getResponse?.().code === 'ORDER_REQUEST_CONFLICT',
      );
      assert.equal(await count(concurrentBody.requestId), 1);
    },
  );
  await check('order-keys-are-scoped-to-the-route-shop', async () => {
    const other = await submit(body(1, concurrentBody.requestId), 1);
    assert.notEqual(other.order.id, concurrentOrder.id);
    assert.equal(await count(concurrentBody.requestId, 1), 1);
  });
  const settled = [];
  for (const method of ['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER']) {
    await check(
      `concurrent-${method.toLowerCase()}-retries-persist-one-receipt`,
      async () => {
        const order = (await submit()).order;
        const dto = await paymentDto(order, method);
        const before = (
          await setup.query(
            "SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1 AND event = 'new_order'",
            [`staff:new-order:${shops[0].id}:kitchen`],
          )
        ).rows[0].n;
        const replies = await concurrent(
          Array.from(
            { length: 6 },
            (_, index) => () =>
              pay(
                order,
                {
                  ...dto,
                  requestId:
                    index % 2 ? dto.requestId.toUpperCase() : dto.requestId,
                },
                index % 2,
              ),
          ),
        );
        replies.forEach((reply) => assert.deepEqual(reply, replies[0]));
        assert.equal(
          await primary.order.count({
            where: { shopId: shops[0].id, paymentRequestId: dto.requestId },
          }),
          1,
        );
        assert.equal(
          (
            await setup.query(
              "SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1 AND event = 'new_order'",
              [`staff:new-order:${shops[0].id}:kitchen`],
            )
          ).rows[0].n - before,
          1,
        );
        settled.push({ order, dto, receipt: replies[0] });
      },
    );
  }
  await check(
    'changed-payment-details-or-actor-never-record-another-payment',
    async () => {
      const { order, dto } = settled[0];
      for (const modified of [
        { ...dto, amountReceived: '30.00' },
        { ...dto, requestId: randomUUID() },
        {
          ...dto,
          method: 'GCASH_MANUAL',
          amountReceived: undefined,
          receivedConfirmed: true,
        },
      ]) {
        await assert.rejects(
          pay(order, modified),
          (error) => error.status === 409,
        );
      }
      await assert.rejects(
        pay(order, dto, 1, 1),
        (error) => error.status === 409,
      );
    },
  );
  await check(
    'competing-cashiers-with-different-keys-have-one-winner',
    async () => {
      const order = (await submit()).order;
      const dtos = [await paymentDto(order), await paymentDto(order)];
      const replies = await Promise.allSettled([
        pay(order, dtos[0]),
        pay(order, dtos[1], 1, 1),
      ]);
      assert.equal(
        replies.filter((reply) => reply.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        replies.find((reply) => reply.status === 'rejected').reason.status,
        409,
      );
    },
  );
  await check(
    'payment-key-cannot-be-reused-on-another-order-even-with-different-case',
    async () => {
      const order = (await submit()).order;
      const dto = await paymentDto(
        order,
        'CASH',
        settled[0].dto.requestId.toUpperCase(),
      );
      await assert.rejects(pay(order, dto), (error) => error.status === 409);
      const saved = await primary.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      assert.equal(saved.paymentStatus, 'UNPAID');
      assert.equal(saved.status, 'PENDING_CONFIRMATION');
    },
  );
  await check(
    'payment-key-can-be-used-independently-in-another-shop',
    async () => {
      const order = (await submit(body(1), 1)).order;
      const dto = await paymentDto(order, 'CASH', settled[0].dto.requestId, 1);
      const reply = await pay(order, dto, 1, 0, 1);
      assert.equal(reply.payment.requestId, settled[0].dto.requestId);
      assert.equal(reply.order.shopId, shops[1].id);
    },
  );
  await check(
    'historical-mixed-case-paid-receipts-replay-without-mutating-immutable-data',
    async () => {
      const source = await primary.order.findUniqueOrThrow({
        where: { id: settled[0].order.id },
      });
      const key = randomUUID().toUpperCase();
      const historical = await primary.order.create({
        data: {
          ...source,
          id: randomUUID(),
          requestId: randomUUID(),
          orderNumber: 'ORD-900003',
          paymentRequestId: key,
          ...tokens.metadata(),
        },
      });
      const lines = await primary.orderItem.findMany({
        where: { shopId: shops[0].id, orderId: source.id },
      });
      await primary.orderItem.createMany({
        data: lines.map((line) => ({
          ...line,
          id: randomUUID(),
          orderId: historical.id,
        })),
      });
      const reply = await cash[1].collect(
        users[0].id,
        shops[0].id,
        historical.id,
        {
          requestId: key.toLowerCase(),
          reviewVersion: historical.paymentReviewVersion,
          amountReceived: '20.00',
        },
      );
      assert.equal(reply.payment.requestId, key.toLowerCase());
      assert.equal(
        (
          await primary.order.findUniqueOrThrow({
            where: { id: historical.id },
          })
        ).paymentRequestId,
        key,
      );
      await assert.rejects(
        setup.query(
          'UPDATE orders SET "paymentRequestId" = lower("paymentRequestId") WHERE id = $1',
          [historical.id],
        ),
        (error) => error.code === '23514',
      );
    },
  );
  await check(
    'failed-line-insert-rolls-back-order-number-and-retries-same-key-safely',
    async () => {
      const request = body();
      request.items[0].notes = 'fixture-force-rollback';
      const before = (
        await primary.shop.findUniqueOrThrow({ where: { id: shops[0].id } })
      ).lastOrderNumber;
      await setup.query(`CREATE FUNCTION fixture_reject_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.notes = 'fixture-force-rollback' THEN RAISE EXCEPTION 'Fixture rollback' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER fixture_reject_line BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fixture_reject_line();`);
      await assert.rejects(submit(request));
      assert.equal(await count(request.requestId), 0);
      assert.equal(
        (await primary.shop.findUniqueOrThrow({ where: { id: shops[0].id } }))
          .lastOrderNumber,
        before,
      );
      await setup.query(
        'DROP TRIGGER fixture_reject_line ON order_items; DROP FUNCTION fixture_reject_line()',
      );
      await submit(request);
      assert.equal(await count(request.requestId), 1);
    },
  );
  await check('replay-still-enforces-live-shop-membership', async () => {
    await primary.shopMember.update({
      where: { userId_shopId: { userId: users[0].id, shopId: shops[0].id } },
      data: { disabledAt: new Date() },
    });
    await assert.rejects(
      pay(settled[0].order, settled[0].dto),
      (error) => error.status === 404 || error.status === 403,
    );
    await primary.shopMember.update({
      where: { userId_shopId: { userId: users[0].id, shopId: shops[0].id } },
      data: { disabledAt: null },
    });
  });
  // Real HTTP delivery loss after a successful commit. Only the response boundary
  // is delayed; order/payment services, guards and SQL remain real.
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(primary)
    .overrideProvider(RequestDeadlineService)
    .useValue(
      new RequestDeadlineService(
        new ConfigService({ API_WRITE_TIMEOUT_MS: '250' }),
      ),
    )
    .compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const post = async (path, value, accessToken) => {
    const reply = await fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(5000),
    });
    return { status: reply.status, body: await reply.json() };
  };
  await check(
    'lost-HTTP-order-response-retries-the-same-committed-order',
    async () => {
      const service = app.get(OrdersService),
        original = service.create.bind(service);
      let first = true;
      service.create = async (...args) => {
        const result = await original(...args);
        if (first) {
          first = false;
          await delay(450);
        }
        return result;
      };
      const request = body();
      try {
        assert.equal(
          (await post(`/menu/${shops[0].slug}/orders`, request)).status,
          504,
        );
        assert.equal(await count(request.requestId), 1);
        const replay = await post(`/menu/${shops[0].slug}/orders`, request);
        assert.equal(replay.status, 201);
        assert.equal(await count(request.requestId), 1);
      } finally {
        service.create = original;
      }
    },
  );
  await check(
    'lost-HTTP-payment-response-retries-one-immutable-receipt',
    async () => {
      const order = (await submit()).order,
        dto = await paymentDto(order);
      const sessionId = randomUUID(),
        expiresAt = new Date(Date.now() + 60000);
      const pair = await app
        .get(TokensService)
        .issue(users[0].id, sessionId, expiresAt);
      await primary.authSession.create({
        data: {
          id: sessionId,
          userId: users[0].id,
          expiresAt,
          refreshTokenHash: app.get(TokensService).digest(pair.refreshToken),
        },
      });
      const service = app.get(CashPaymentService),
        original = service.create.bind(service);
      let first = true;
      service.create = async (...args) => {
        const result = await original(...args);
        if (first) {
          first = false;
          await delay(450);
        }
        return result;
      };
      try {
        const path = `/shops/${shops[0].id}/orders/${order.id}/create-payment`;
        assert.equal((await post(path, dto, pair.accessToken)).status, 504);
        const saved = await primary.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        assert.equal(saved.paymentStatus, 'PAID');
        const replay = await post(path, dto, pair.accessToken);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.payment.requestId, dto.requestId);
        assert.equal(
          (
            await primary.order.findUniqueOrThrow({ where: { id: order.id } })
          ).paidAt.getTime(),
          saved.paidAt.getTime(),
        );
      } finally {
        service.create = original;
      }
    },
  );
  await check(
    'processed-order-retries-conflict-without-creating-a-new-order',
    async () => {
      await assert.rejects(
        submit(historicalBody),
        (error) => error.getResponse?.().code === 'ORDER_ALREADY_PROCESSED',
      );
    },
  );
  await delay(500);
  assert.equal(app.get(ApiCapacityService).snapshot().active.total, 0);
} finally {
  if (app) await app.close();
  await Promise.all([
    primary.$disconnect(),
    replica.$disconnect(),
    setup.end(),
  ]);
  const report = {
    pass: results.length === 20,
    scope: 'disposable-postgres-real-migrations-services-and-http',
    migration: '20261028090000_idempotency_key_identity',
    checks: results,
  };
  if (process.env.TIMEOUT_DB_REPORT) {
    await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
    await writeFile(
      process.env.TIMEOUT_DB_REPORT,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
assert.equal(results.length, 20);
console.log(
  `PASS: ${results.length} real PostgreSQL idempotency checks; no application database or provider contacted.`,
);
