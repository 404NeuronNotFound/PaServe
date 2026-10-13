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
  await prisma.shopMember.update({
    where: { userId_shopId: { userId: users[0].id, shopId: shop.id } },
    data: { role: 'KITCHEN' },
  });
  await assert.rejects(cash.review(users[0].id, shop.id, order.id), {
    status: 404,
  });
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
