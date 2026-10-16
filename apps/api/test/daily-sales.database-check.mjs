// Real PostgreSQL reconciliation. Private schema and all fixture data roll back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { CompletedSalesService } from '../dist/modules/orders/completed-sales.service.js';

const schema = `daily_sales_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^daily_sales_[a-f0-9]{32}$/);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
const pool = new pg.Pool({
  connectionString: 'postgres://unused:unused@127.0.0.1:1/unused',
});
pool.query = (query) => client.query(query);
pool.connect = async () => {
  throw new Error('Only the rollback fixture connection may be used');
};
const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
let transaction = false;
try {
  await client.connect();
  await client.query('BEGIN');
  transaction = true;
  await client.query(`CREATE SCHEMA "${schema}"`);
  for (const name of ['MenuLayout', 'OrderMode', 'ShopRole']) {
    const labels = await client.query(
      'SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname=$2 ORDER BY e.enumsortorder',
      ['public', name],
    );
    assert.ok(labels.rows.length);
    await client.query(
      `CREATE TYPE "${schema}"."${name}" AS ENUM (${labels.rows.map((row) => `'${row.enumlabel.replaceAll("'", "''")}'`).join(',')})`,
    );
  }
  for (const table of [
    'users',
    'shops',
    'shop_members',
    'orders',
    'order_items',
  ]) {
    await client.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );
  }
  for (const [table, column, type, initial] of [
    ['shops', 'menuLayout', 'MenuLayout', 'list'],
    ['shop_members', 'role', 'ShopRole', null],
    ['orders', 'mode', 'OrderMode', 'DINE_IN'],
  ]) {
    await client.query(
      `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
    );
    await client.query(
      `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" TYPE "${schema}"."${type}" USING "${column}"::text::"${schema}"."${type}"`,
    );
    if (initial)
      await client.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT '${initial}'::"${schema}"."${type}"`,
      );
  }
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  const actor = await prisma.user.create({
    data: {
      email: 'daily-sales@example.com',
      passwordHash: 'unused-test-hash',
    },
  });
  const shop = await prisma.shop.create({
    data: { name: 'Daily sales', slug: 'daily-sales' },
  });
  const foreign = await prisma.shop.create({
    data: { name: 'Other shop', slug: 'other-shop' },
  });
  const membership = await prisma.shopMember.create({
    data: { userId: actor.id, shopId: shop.id, role: 'OWNER' },
  });
  await prisma.shopMember.create({
    data: { userId: actor.id, shopId: foreign.id, role: 'OWNER' },
  });
  const base = new Date('2026-10-14T00:00:00.000Z');
  let number = 0;
  const orderData = (overrides = {}) => ({
    shopId: shop.id,
    requestId: randomUUID(),
    requestHash: 'a'.repeat(64),
    orderNumber: `ORD-${String(++number).padStart(6, '0')}`,
    mode: 'TAKEOUT',
    currency: 'PHP',
    totalPrice: '900.00',
    items: [{ productId: randomUUID(), quantity: 1 }],
    qrTokenNonce: randomUUID(),
    qrTokenExpiresAt: new Date('2099-01-01T00:00:00Z'),
    createdAt: base,
    ...overrides,
  });
  const paidData = () => ({
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRequestId: randomUUID(),
    paymentReviewVersion: 'b'.repeat(64),
    amountReceived: '900.00',
    changeDue: '0.00',
    decidedAt: base,
    decidedBy: actor.id,
    qrTokenRevokedAt: base,
    paidAt: base,
    paidBy: actor.id,
    preparationStatus: 'QUEUED',
    queuedAt: base,
  });
  const completed = async (time, amount, overrides = {}) =>
    prisma.order.create({
      data: orderData({
        ...paidData(),
        totalPrice: amount,
        amountReceived: amount,
        preparationStatus: 'COMPLETED',
        preparationStartedAt: base,
        preparationStartedBy: actor.id,
        preparationReadyAt: base,
        preparationReadyBy: actor.id,
        completedAt: new Date(time),
        completedBy: actor.id,
        ...overrides,
      }),
    });

  const expected = [];
  expected.push(
    await completed('2026-10-15T16:00:00.000Z', '0.10', {
      amountReceived: '1.00',
      changeDue: '0.90',
    }),
  ); // Start included; tender/change must not inflate sales.
  expected.push(await completed('2026-10-16T15:59:59.999Z', '0.20')); // Last millisecond: included.
  for (const paymentMethod of ['GCASH_MANUAL', 'CARD_MANUAL', 'OTHER']) {
    expected.push(
      await completed('2026-10-16T04:00:00.000Z', '10.01', {
        paymentMethod,
        paymentDescription: paymentMethod === 'OTHER' ? 'Voucher' : null,
      }),
    );
  }
  expected.push(await completed('2026-10-16T04:00:00.000Z', '9999999999.99'));
  expected.push(await completed('2026-10-16T04:00:00.000Z', '0.00'));
  // More than a history page: the metric must aggregate the entire day.
  for (let index = 0; index < 30; index++)
    expected.push(await completed('2026-10-16T04:00:00.000Z', '1.00'));
  await completed('2026-10-15T15:59:59.999Z', '900.00'); // Before start: excluded.
  await completed('2026-10-16T16:00:00.000Z', '900.00'); // Exactly end: excluded.
  await completed('2026-10-16T04:00:00.000Z', '900.00', { shopId: foreign.id });
  await prisma.order.create({ data: orderData() }); // Pending/unpaid: excluded.
  await prisma.order.create({
    data: orderData({
      status: 'REJECTED',
      decidedAt: base,
      decidedBy: actor.id,
      rejectionReason: 'Test rejection',
      qrTokenRevokedAt: base,
    }),
  });
  for (const stage of ['QUEUED', 'PREPARING', 'READY']) {
    await prisma.order.create({
      data: orderData({
        ...paidData(),
        preparationStatus: stage,
        ...(stage !== 'QUEUED'
          ? { preparationStartedAt: base, preparationStartedBy: actor.id }
          : {}),
        ...(stage === 'READY'
          ? { preparationReadyAt: base, preparationReadyBy: actor.id }
          : {}),
      }),
    });
  }

  // Snapshot rows retain quantities even after the original product is gone.
  const allOrders = await prisma.order.findMany();
  for (const order of allOrders) {
    const quantities =
      order.id === expected[0].id
        ? [2, 3]
        : expected.some((row) => row.id === order.id)
          ? [1]
          : [99];
    for (const [index, quantity] of quantities.entries()) {
      const productId = randomUUID();
      const snapshot = {
        productId,
        productName: 'Saved item',
        currency: 'PHP',
        quantity,
        basePrice: '0.00',
        unitPrice: '0.00',
        totalPrice: '0.00',
        variants: [],
        addOns: [],
      };
      await prisma.orderItem.create({
        data: {
          shopId: order.shopId,
          orderId: order.id,
          lineNumber: index + 1,
          quantity,
          snapshot,
          productSnapshotId: productId,
          productNameSnapshot: snapshot.productName,
          currency: 'PHP',
          basePriceSnapshot: '0.00',
          unitPriceSnapshot: '0.00',
          lineTotalSnapshot: '0.00',
          variantsSnapshot: [],
          addOnsSnapshot: [],
        },
      });
    }
  }
  // The fixture already pins every query to this rollback-only transaction.
  // Do not start a nested BEGIN through Prisma, which would commit fixture DDL.
  const pinned = new Proxy(prisma, {
    get(target, property, receiver) {
      return property === '$transaction'
        ? async (work) => work(target)
        : Reflect.get(target, property, receiver);
    },
  });
  const sales = new CompletedSalesService(pinned);
  const report = await sales.daily(actor.id, shop.id, '2026-10-16');
  // Independently filter persisted rows using PostgreSQL business-date conversion.
  // Do not reuse the service's bounds helper or its aggregate query.
  const { rows } = await client.query(
    `SELECT id, "paymentMethod", "totalPrice"::text AS total FROM "${schema}".orders WHERE "shopId"=$1 AND status='CONFIRMED' AND "paymentStatus"='PAID' AND "preparationStatus"='COMPLETED' AND "completedBy" IS NOT NULL AND currency='PHP' AND (("completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date=$2::date ORDER BY id`,
    [shop.id, '2026-10-16'],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    expected.map((row) => row.id).sort(),
  );
  const totalCents = rows.reduce(
    (sum, row) => sum + BigInt(row.total.replace('.', '')),
    0n,
  );
  const expectedTotal = `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`;
  assert.equal(report.completedOrders, rows.length);
  assert.equal(report.totalSales, expectedTotal);
  assert.equal(report.totalSales, '10000000060.32');
  assert.equal(report.completedOrders, 37);
  assert.equal(report.paymentBreakdown.length, 4);
  for (const entry of report.paymentBreakdown) {
    const methodOrders = rows.filter(
      (row) => row.paymentMethod === entry.paymentMethod,
    );
    assert.equal(entry.orders, methodOrders.length);
    assert.equal(
      BigInt(entry.totalSales.replace('.', '')),
      methodOrders.reduce(
        (sum, row) => sum + BigInt(row.total.replace('.', '')),
        0n,
      ),
    );
  }
  assert.deepEqual(report.paymentBreakdown, [
    { paymentMethod: 'CASH', orders: 34, totalSales: '10000000030.29' },
    { paymentMethod: 'GCASH_MANUAL', orders: 1, totalSales: '10.01' },
    { paymentMethod: 'CARD_MANUAL', orders: 1, totalSales: '10.01' },
    { paymentMethod: 'OTHER', orders: 1, totalSales: '10.01' },
  ]);
  const emptyPayments = (await sales.daily(actor.id, shop.id, '2026-10-18'))
    .paymentBreakdown;
  assert.ok(
    emptyPayments.every(
      (entry) => entry.orders === 0 && entry.totalSales === '0.00',
    ),
  );
  const savedItems = await client.query(
    `SELECT "orderId", "lineNumber", quantity FROM "${schema}".order_items WHERE "shopId"=$1 AND "orderId"=ANY($2::text[]) ORDER BY "orderId", "lineNumber"`,
    [shop.id, rows.map((row) => row.id)],
  );
  assert.equal(
    savedItems.rows.length,
    38,
    'Detailed lines differ from units sold',
  );
  assert.deepEqual(
    savedItems.rows
      .filter((line) => line.orderId === expected[0].id)
      .map((line) => line.quantity),
    [2, 3],
  );
  assert.equal(
    report.itemsSold,
    savedItems.rows.reduce((sum, line) => sum + line.quantity, 0),
    'Metric equals the quantities on every eligible detailed line',
  );
  assert.equal(
    report.itemsSold,
    41,
    'Sum quantities, not line count or order count',
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-17')).itemsSold,
    99,
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-18')).itemsSold,
    0,
  );
  assert.equal(
    (await sales.daily(actor.id, foreign.id, '2026-10-16')).itemsSold,
    99,
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-16')).completedOrders,
    37,
    'Refreshing does not double-count orders',
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-17')).completedOrders,
    1,
    'Next midnight belongs to the next period',
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-18')).completedOrders,
    0,
    'Empty periods count zero orders',
  );
  assert.equal(
    (await sales.daily(actor.id, foreign.id, '2026-10-16')).completedOrders,
    1,
    'Counts remain scoped to the selected shop',
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-17')).totalSales,
    '900.00',
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-18')).totalSales,
    '0.00',
  );
  assert.equal(
    (await sales.daily(actor.id, foreign.id, '2026-10-16')).totalSales,
    '900.00',
  );
  await prisma.shopMember.update({
    where: { id: membership.id },
    data: { role: 'CASHIER' },
  });
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-16')).itemsSold,
    0,
  );
  assert.equal(
    (await sales.daily(actor.id, shop.id, '2026-10-16')).totalSales,
    '0.00',
  );
  console.log(
    JSON.stringify({
      passed: true,
      criterion: 'Metric matches filtered underlying orders',
      businessDate: '2026-10-16',
      timezone: report.timezone,
      matchedOrders: rows.length,
      itemsSold: report.itemsSold,
      paymentBreakdown: report.paymentBreakdown,
      grossSales: report.totalSales,
      checks:
        'Independent SQL reconciliation, exact cents, all payment methods, >25 orders, start/end boundaries, completion vs payment day, unfinished/unpaid/rejected/foreign exclusions, empty day and revoked access predicate',
      scope: 'Real PostgreSQL in private schema; all fixture data rolled back',
    }),
  );
} catch (error) {
  console.error(
    'Daily sales reconciliation failed:',
    error.code ?? error.name,
    String(error.message)
      .replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
      .slice(0, 1200),
  );
  process.exitCode = 1;
} finally {
  if (transaction) {
    await client.query('ROLLBACK');
    const remaining = await client.query(
      'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1',
      [schema],
    );
    assert.equal(
      remaining.rows[0].count,
      0,
      'Fixture schema must not survive rollback',
    );
  }
  await prisma.$disconnect();
  await pool.end();
  await client.end();
}
