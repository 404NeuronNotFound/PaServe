import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { OrderQrService } from '../dist/modules/orders/order-qr.service.js';
import { OrderDecisionService } from '../dist/modules/orders/order-decision.service.js';
import { CashPaymentService } from '../dist/modules/orders/cash-payment.service.js';

// Real competing service transactions use only this disposable schema. Public
// tables and migration history remain untouched; close sessions before removal.
const schema = `cash_payment_check_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^cash_payment_check_[0-9a-f]{32}$/);
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;
let prisma;
try {
  await setup.connect();
  await setup.query('BEGIN');
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(
    `CREATE TYPE "${schema}"."MenuLayout" AS ENUM ('grid', 'list', 'compact')`,
  );
  await setup.query(
    `CREATE TYPE "${schema}"."ShopRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN')`,
  );
  await setup.query(
    `CREATE TYPE "${schema}"."OrderMode" AS ENUM ('DINE_IN', 'TAKEOUT')`,
  );
  for (const table of [
    'users',
    'shops',
    'shop_members',
    'orders',
    'order_items',
  ]) {
    await setup.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );
  }
  await setup.query(
    `ALTER TABLE "${schema}".shops ALTER COLUMN "menuLayout" DROP DEFAULT, ALTER COLUMN "menuLayout" TYPE "${schema}"."MenuLayout" USING "menuLayout"::text::"${schema}"."MenuLayout", ALTER COLUMN "menuLayout" SET DEFAULT 'list'::"${schema}"."MenuLayout"`,
  );
  await setup.query(
    `ALTER TABLE "${schema}".shop_members ALTER COLUMN role TYPE "${schema}"."ShopRole" USING role::text::"${schema}"."ShopRole"`,
  );
  await setup.query(
    `ALTER TABLE "${schema}".orders ALTER COLUMN mode DROP DEFAULT, ALTER COLUMN mode TYPE "${schema}"."OrderMode" USING mode::text::"${schema}"."OrderMode", ALTER COLUMN mode SET DEFAULT 'DINE_IN'::"${schema}"."OrderMode"`,
  );
  await setup.query(`SET LOCAL search_path TO "${schema}", public`);
  const columns = await setup.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'orders' AND column_name = 'decidedAt'`,
    [schema],
  );
  if (!columns.rowCount) {
    const sql = await readFile(
      new URL(
        '../prisma/migrations/20261013140000_cashier_order_decisions/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await setup.query(sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  }
  // Rebuild the pre-cash shape in our private schema, even after deployment,
  // then exercise the complete migration (including its trigger definition).
  for (const column of [
    'paymentDescription',
    'paymentReference',
    'paymentMethod',
    'paymentRequestId',
    'paymentReviewVersion',
    'amountReceived',
    'changeDue',
    'paidAt',
    'paidBy',
  ])
    await setup.query(
      `ALTER TABLE "${schema}".orders DROP COLUMN IF EXISTS "${column}" CASCADE`,
    );
  await setup.query(
    `ALTER TABLE "${schema}".orders DROP CONSTRAINT IF EXISTS "orders_payment_status_check"`,
  );
  await setup.query(
    `ALTER TABLE "${schema}".orders DROP CONSTRAINT IF EXISTS "orders_paymentStatus_check"`,
  );
  await setup.query(
    `ALTER TABLE "${schema}".orders ADD CONSTRAINT "orders_paymentStatus_check" CHECK ("paymentStatus" = 'UNPAID')`,
  );
  const cashSql = await readFile(
    new URL(
      '../prisma/migrations/20261013190000_cash_payments/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query(cashSql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  const referenceSql = await readFile(
    new URL(
      '../prisma/migrations/20261013210000_manual_gcash_reference/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query(referenceSql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  // Nullable placeholder supports generated reads while exercising pre-OTHER migrations.
  await setup.query(
    'ALTER TABLE orders ADD COLUMN "paymentDescription" VARCHAR(80)',
  );
  await setup.query('COMMIT');
  created = true;
  prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        max: 4,
        options: `-c search_path=${schema},public`,
      },
      { schema },
    ),
  });
  const tokens = new OrderTokenService(
    new ConfigService({
      JWT_ACCESS_SECRET:
        'order-decision-race-test-secret-at-least-32-characters',
    }),
  );
  const qr = new OrderQrService(prisma, tokens);
  const decisions = new OrderDecisionService(prisma, qr);
  const cash = new CashPaymentService(prisma, qr);
  const users = await Promise.all(
    [1, 2].map((n) =>
      prisma.user.create({
        data: { email: `race-${n}@example.com`, passwordHash: 'unused' },
      }),
    ),
  );
  const shop = await prisma.shop.create({
    data: { name: 'Race check', slug: 'race-check' },
  });
  for (const user of users)
    await prisma.shopMember.create({
      data: { userId: user.id, shopId: shop.id, role: 'CASHIER' },
    });
  const quote = {
    productId: randomUUID(),
    productName: 'Saved coffee',
    currency: 'PHP',
    quantity: 1,
    basePrice: '10.00',
    unitPrice: '10.00',
    totalPrice: '10.00',
    variants: [],
    addOns: [],
  };
  const order = await prisma.order.create({
    data: {
      shopId: shop.id,
      requestId: randomUUID(),
      requestHash: 'a'.repeat(64),
      mode: 'TAKEOUT',
      orderNumber: 'ORD-000001',
      totalPrice: '10.00',
      items: [quote],
      ...tokens.metadata(),
    },
  });
  await prisma.orderItem.create({
    data: {
      shopId: shop.id,
      orderId: order.id,
      lineNumber: 1,
      quantity: 1,
      snapshot: quote,
      productSnapshotId: quote.productId,
      productNameSnapshot: quote.productName,
      basePriceSnapshot: '10.00',
      unitPriceSnapshot: '10.00',
      lineTotalSnapshot: '10.00',
      variantsSnapshot: [],
      addOnsSnapshot: [],
    },
  });
  const token = tokens.issue(order);
  const { reviewVersion } = (await qr.scan(users[0].id, shop.id, token)).order;
  const dto = { qrToken: token, reviewVersion };
  await assert.rejects(cash.review(users[0].id, shop.id, order.id), {
    status: 409,
  });
  await decisions.decide(users[0].id, shop.id, order.id, 'CONFIRMED', dto);
  const review = await cash.review(users[0].id, shop.id, order.id);
  await assert.rejects(
    cash.collect(users[0].id, shop.id, order.id, {
      requestId: randomUUID(),
      amountReceived: '9.99',
      reviewVersion: review.order.reviewVersion,
    }),
    { status: 400 },
  );
  const cashRequests = users.map(() => ({
    requestId: randomUUID(),
    amountReceived: '20.00',
    reviewVersion: review.order.reviewVersion,
  }));
  const results = await Promise.allSettled(
    users.map((user, index) =>
      cash.collect(user.id, shop.id, order.id, cashRequests[index]),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const loser = results.find((result) => result.status === 'rejected');
  assert.equal(loser.reason.status, 409);
  const winnerIndex = results.findIndex(
    (result) => result.status === 'fulfilled',
  );
  const winner = results[winnerIndex].value;
  const saved = await prisma.order.findFirst({
    where: { id: order.id, shopId: shop.id },
  });
  assert.equal(saved.status, 'CONFIRMED');
  assert.equal(saved.paymentStatus, 'PAID');
  assert.equal(saved.paymentMethod, 'CASH');
  assert.equal(saved.amountReceived.toFixed(2), '20.00');
  assert.equal(saved.changeDue.toFixed(2), '10.00');
  assert.equal(saved.paidBy, users[winnerIndex].id);
  assert.deepEqual(
    await cash.collect(
      users[winnerIndex].id,
      shop.id,
      order.id,
      cashRequests[winnerIndex],
    ),
    winner,
  );
  assert.deepEqual(
    await cash.lookup(users[0].id, shop.id, order.orderNumber),
    winner,
  );
  assert.ok(
    saved.decidedAt instanceof Date && saved.qrTokenRevokedAt instanceof Date,
  );
  await assert.rejects(
    cash.collect(users[0].id, shop.id, order.id, {
      ...cashRequests[0],
      requestId: randomUUID(),
    }),
    { status: 409 },
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: order.id, shopId: shop.id },
      data: { amountReceived: '30.00', changeDue: '20.00' },
    }),
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: order.id, shopId: shop.id },
      data: { paymentStatus: 'UNPAID' },
    }),
  );
  // Upgrade a schema containing an actual paid CASH receipt before settling GCash.
  const gcashSql = await readFile(
    new URL(
      '../prisma/migrations/20261013200000_manual_gcash_payments/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query('BEGIN');
  await setup.query(`SET LOCAL search_path TO "${schema}", public`);
  await setup.query(gcashSql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  await setup.query('COMMIT');
  assert.deepEqual(
    await cash.review(users[winnerIndex].id, shop.id, order.id),
    winner,
  );
  async function confirmedOrder(number, total = '10.00') {
    const savedQuote = {
      ...quote,
      basePrice: total,
      unitPrice: total,
      totalPrice: total,
    };
    return prisma.order.create({
      data: {
        shopId: shop.id,
        requestId: randomUUID(),
        requestHash: 'a'.repeat(64),
        mode: 'TAKEOUT',
        orderNumber: number,
        totalPrice: total,
        items: [savedQuote],
        ...tokens.metadata(),
        status: 'CONFIRMED',
        decidedAt: new Date(),
        decidedBy: users[0].id,
        qrTokenRevokedAt: new Date(),
        orderItems: {
          create: {
            lineNumber: 1,
            quantity: 1,
            snapshot: savedQuote,
            productSnapshotId: quote.productId,
            productNameSnapshot: quote.productName,
            basePriceSnapshot: total,
            unitPriceSnapshot: total,
            lineTotalSnapshot: total,
            variantsSnapshot: [],
            addOnsSnapshot: [],
          },
        },
      },
    });
  }
  const gcashOrder = await confirmedOrder('ORD-000002');
  const gcashReview = await cash.review(users[0].id, shop.id, gcashOrder.id);
  const gcashRequest = {
    requestId: randomUUID(),
    reviewVersion: gcashReview.order.reviewVersion,
    receivedConfirmed: true,
    reference: '  001234567890 - receipt checked  ',
  };
  const gcashResult = await cash.recordGcash(
    users[0].id,
    shop.id,
    gcashOrder.id,
    gcashRequest,
  );
  const persistedGcash = await prisma.order.findFirst({
    where: { id: gcashOrder.id, shopId: shop.id },
  });
  assert.equal(persistedGcash.paymentMethod, 'GCASH_MANUAL');
  assert.equal(
    persistedGcash.paymentReference,
    '001234567890 - receipt checked',
  );
  assert.equal(gcashResult.payment.reference, '001234567890 - receipt checked');
  await assert.rejects(
    cash.recordGcash(users[0].id, shop.id, gcashOrder.id, {
      ...gcashRequest,
      reference: 'changed',
    }),
    { status: 409 },
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: gcashOrder.id, shopId: shop.id },
      data: { paymentReference: 'changed' },
    }),
  );
  assert.equal(persistedGcash.paymentStatus, 'PAID');
  assert.equal(persistedGcash.amountReceived.toFixed(2), '10.00');
  assert.equal(persistedGcash.changeDue.toFixed(2), '0.00');
  assert.equal(persistedGcash.paidBy, users[0].id);
  assert.deepEqual(
    await cash.recordGcash(users[0].id, shop.id, gcashOrder.id, gcashRequest),
    gcashResult,
  );
  assert.deepEqual(
    await cash.lookup(users[0].id, shop.id, gcashOrder.orderNumber),
    gcashResult,
  );
  await assert.rejects(
    cash.collect(users[1].id, shop.id, gcashOrder.id, {
      requestId: randomUUID(),
      reviewVersion: gcashReview.order.reviewVersion,
      amountReceived: '10.00',
    }),
    { status: 409 },
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: gcashOrder.id, shopId: shop.id },
      data: { paymentMethod: 'CASH' },
    }),
  );
  const cardSql = await readFile(
    new URL(
      '../prisma/migrations/20261013220000_manual_card_payments/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query('BEGIN');
  await setup.query(`SET LOCAL search_path TO "${schema}", public`);
  await setup.query(cardSql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  await setup.query('COMMIT');
  assert.deepEqual(
    await cash.review(users[winnerIndex].id, shop.id, order.id),
    winner,
  );
  assert.deepEqual(
    await cash.review(users[0].id, shop.id, gcashOrder.id),
    gcashResult,
  );
  const cardOrder = await confirmedOrder('ORD-000004');
  const cardVersion = (await cash.review(users[0].id, shop.id, cardOrder.id))
    .order.reviewVersion;
  const cardRequest = {
    requestId: randomUUID(),
    reviewVersion: cardVersion,
    receivedConfirmed: true,
    reference: '00001234 terminal receipt',
  };
  const cardResult = await cash.recordCard(
    users[0].id,
    shop.id,
    cardOrder.id,
    cardRequest,
  );
  const savedCard = await prisma.order.findFirst({
    where: { id: cardOrder.id, shopId: shop.id },
  });
  assert.equal(savedCard.paymentMethod, 'CARD_MANUAL');
  assert.equal(savedCard.paymentStatus, 'PAID');
  assert.equal(savedCard.amountReceived.toFixed(2), '10.00');
  assert.equal(savedCard.changeDue.toFixed(2), '0.00');
  assert.equal(savedCard.paymentReference, cardRequest.reference);
  assert.equal(savedCard.paidBy, users[0].id);
  assert.ok(savedCard.paidAt instanceof Date);
  assert.deepEqual(
    await cash.recordCard(users[0].id, shop.id, cardOrder.id, cardRequest),
    cardResult,
  );
  assert.deepEqual(
    await cash.lookup(users[0].id, shop.id, cardOrder.orderNumber),
    cardResult,
  );
  await assert.rejects(
    cash.recordCard(users[0].id, shop.id, cardOrder.id, {
      ...cardRequest,
      reference: 'changed',
    }),
    { status: 409 },
  );
  await assert.rejects(
    cash.recordGcash(users[0].id, shop.id, cardOrder.id, cardRequest),
    { status: 409 },
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: cardOrder.id, shopId: shop.id },
      data: { paymentReference: 'changed' },
    }),
  );
  const otherSql = await readFile(
    new URL(
      '../prisma/migrations/20261013230000_other_payments/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query('BEGIN');
  await setup.query(`SET LOCAL search_path TO "${schema}", public`);
  await setup.query('ALTER TABLE orders DROP COLUMN "paymentDescription"');
  await setup.query(otherSql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  await setup.query('COMMIT');
  assert.deepEqual(
    await cash.review(users[winnerIndex].id, shop.id, order.id),
    winner,
  );
  assert.deepEqual(
    await cash.review(users[0].id, shop.id, gcashOrder.id),
    gcashResult,
  );
  assert.deepEqual(
    await cash.review(users[0].id, shop.id, cardOrder.id),
    cardResult,
  );
  const otherOrder = await confirmedOrder('ORD-000005');
  const otherVersion = (await cash.review(users[0].id, shop.id, otherOrder.id))
    .order.reviewVersion;
  const otherRequest = {
    requestId: randomUUID(),
    reviewVersion: otherVersion,
    receivedConfirmed: true,
    description: 'Bank transfer',
    reference: '00001234 receipt',
  };
  await assert.rejects(
    cash.recordOther(users[0].id, shop.id, otherOrder.id, {
      ...otherRequest,
      description: ' ',
    }),
    { status: 400 },
  );
  await assert.rejects(
    cash.recordOther(users[0].id, shop.id, otherOrder.id, {
      ...otherRequest,
      reference: '4111111111111111',
    }),
    { status: 400 },
  );
  const otherResult = await cash.recordOther(
    users[0].id,
    shop.id,
    otherOrder.id,
    otherRequest,
  );
  const savedOther = await prisma.order.findFirst({
    where: { id: otherOrder.id, shopId: shop.id },
  });
  assert.equal(savedOther.paymentMethod, 'OTHER');
  assert.equal(savedOther.paymentDescription, 'Bank transfer');
  assert.equal(savedOther.paymentReference, otherRequest.reference);
  assert.equal(savedOther.amountReceived.toFixed(2), '10.00');
  assert.equal(savedOther.changeDue.toFixed(2), '0.00');
  assert.equal(savedOther.paidBy, users[0].id);
  assert.equal(savedOther.shopId, shop.id);
  assert.equal(savedOther.id, otherOrder.id);
  assert.equal(savedOther.paymentRequestId, otherRequest.requestId);
  assert.ok(savedOther.paidAt instanceof Date);
  assert.deepEqual(
    await cash.lookup(users[0].id, shop.id, otherOrder.orderNumber),
    otherResult,
  );
  assert.deepEqual(
    await cash.recordOther(users[0].id, shop.id, otherOrder.id, otherRequest),
    otherResult,
  );
  await assert.rejects(
    cash.recordOther(users[0].id, shop.id, otherOrder.id, {
      ...otherRequest,
      description: 'Voucher',
    }),
    { status: 409 },
  );
  await assert.rejects(
    prisma.order.updateMany({
      where: { id: otherOrder.id, shopId: shop.id },
      data: { paymentDescription: 'Voucher' },
    }),
  );
  console.log(
    'Passed: OTHER requires a saved description and full-payment attestation, stores method/reference/actor with zero change, rejects common card details, preserves existing receipts and rejects altered retries.',
  );
  for (const [number, total, tender, expectedChange] of [
    ['ORD-000006', '0.10', '0.30', '0.20'],
    ['ORD-000007', '10.00', '9999999999.99', '9999999989.99'],
    ['ORD-000008', '0.00', '0.00', '0.00'],
  ]) {
    const tenderOrder = await confirmedOrder(number, total);
    const tenderVersion = (
      await cash.review(users[0].id, shop.id, tenderOrder.id)
    ).order.reviewVersion;
    const dto = {
      requestId: randomUUID(),
      reviewVersion: tenderVersion,
      amountReceived: tender,
    };
    for (const invalid of ['0.001', '10000000000.00', 'Infinity', 200])
      await assert.rejects(
        cash.collect(users[0].id, shop.id, tenderOrder.id, {
          ...dto,
          amountReceived: invalid,
        }),
        { status: 400 },
      );
    const result = await cash.collect(
      users[0].id,
      shop.id,
      tenderOrder.id,
      dto,
    );
    const persisted = await prisma.order.findFirst({
      where: { id: tenderOrder.id, shopId: shop.id },
    });
    assert.equal(persisted.amountReceived.toFixed(2), tender);
    assert.equal(persisted.changeDue.toFixed(2), expectedChange);
    assert.equal(result.payment.amountReceived, tender);
  }
  console.log(
    'Passed: cash tender fractional precision, Decimal(12,2) maximum, zero-total exact payment and invalid-tender rejection before saving.',
  );
  const raceOrder = await confirmedOrder('ORD-000003');
  const raceVersion = (await cash.review(users[0].id, shop.id, raceOrder.id))
    .order.reviewVersion;
  // GCash/cash share the same order lock and UNPAID predicate.
  const competing = await Promise.allSettled([
    cash.recordOther(users[0].id, shop.id, raceOrder.id, {
      requestId: randomUUID(),
      reviewVersion: raceVersion,
      receivedConfirmed: true,
      description: 'Shop voucher',
    }),
    cash.recordCard(users[0].id, shop.id, raceOrder.id, {
      requestId: randomUUID(),
      reviewVersion: raceVersion,
      receivedConfirmed: true,
    }),
    cash.recordGcash(users[0].id, shop.id, raceOrder.id, {
      requestId: randomUUID(),
      reviewVersion: raceVersion,
      receivedConfirmed: true,
    }),
    cash.collect(users[1].id, shop.id, raceOrder.id, {
      requestId: randomUUID(),
      reviewVersion: raceVersion,
      amountReceived: '20.00',
    }),
  ]);
  assert.equal(
    competing.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    competing.find((result) => result.status === 'rejected').reason.status,
    409,
  );
  const raceSaved = await prisma.order.findFirst({
    where: { id: raceOrder.id, shopId: shop.id },
  });
  assert.ok(
    ['CASH', 'GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'].includes(
      raceSaved.paymentMethod,
    ),
  );
  console.log(
    'Passed: manual card migration preserves cash/GCash receipts, method/reference/actor persistence, full settlement, zero change, exact replay and competing card/cash/GCash commits once.',
  );
  console.log(
    'Passed: manual GCash migration preserves CASH, exact full settlement, zero change, saved actor, replay, immutable method and competing cash/GCash recording commits once.',
  );
  await prisma.shopMember.update({
    where: { userId_shopId: { userId: users[0].id, shopId: shop.id } },
    data: { role: 'KITCHEN' },
  });
  await assert.rejects(cash.review(users[0].id, shop.id, order.id), {
    status: 404,
  });
  await assert.rejects(cash.review(users[0].id, shop.id, otherOrder.id), {
    status: 404,
  });
  await assert.rejects(
    cash.recordOther(users[0].id, shop.id, otherOrder.id, otherRequest),
    {
      status: 404,
    },
  );
  console.log(
    'Passed: cash migration, confirmed-only collection, underpayment, exact change, competing collectors commit once, idempotent replay, immutable receipts and revoked access.',
  );
} finally {
  if (prisma) await prisma.$disconnect();
  if (created) {
    await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    const remaining = await setup.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
      [schema],
    );
    assert.equal(remaining.rowCount, 0);
    console.log('Removed isolated cash-payment test schema.');
  } else await setup.query('ROLLBACK').catch(() => {});
  await setup.end();
}
