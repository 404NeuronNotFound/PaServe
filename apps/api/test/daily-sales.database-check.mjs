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
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
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
  const recentRows = await client.query(
    `SELECT id, "orderNumber", "totalPrice"::text AS total, to_char("completedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time FROM "${schema}".orders WHERE id=ANY($1::text[]) ORDER BY "completedAt" DESC, id DESC LIMIT 10`,
    [rows.map((row) => row.id)],
  );
  assert.equal(report.recentOrders.length, 10);
  assert.deepEqual(
    report.recentOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      total: order.totalPrice,
      time: order.completedAt,
    })),
    recentRows.rows,
  );
  assert.ok(
    report.recentOrders.every(
      (order) =>
        order.shopId === shop.id &&
        order.status === 'CONFIRMED' &&
        order.paymentStatus === 'PAID' &&
        order.preparationStatus === 'COMPLETED',
    ),
  );
  assert.deepEqual(
    (await sales.daily(actor.id, shop.id, '2026-10-18')).recentOrders,
    [],
  );
  assert.equal(
    (await sales.daily(actor.id, foreign.id, '2026-10-16')).recentOrders.length,
    1,
  );
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
  const analytics = await sales.dailyAnalytics(actor.id, shop.id, '2026-10-15', '2026-10-18');
  assert.equal(analytics.days.length, 4);
  let rangeCents = 0n, rangeOrders = 0, rangeItems = 0;
  for (const day of analytics.days) {
    // Reconcile each analytics row directly to persisted eligible orders,
    // independently of both reporting services and their date-bound helpers.
    const underlying = await client.query(
      `SELECT o.id, o."totalPrice"::text AS total,
        (SELECT coalesce(sum(i.quantity), 0)::text FROM "${schema}".order_items i
         WHERE i."shopId"=o."shopId" AND i."orderId"=o.id) AS units
       FROM "${schema}".orders o WHERE o."shopId"=$1
         AND o.status='CONFIRMED' AND o."paymentStatus"='PAID'
         AND o."preparationStatus"='COMPLETED' AND o."completedBy" IS NOT NULL
         AND o.currency='PHP'
         AND ((o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date=$2::date`,
      [shop.id, day.businessDate],
    );
    const cents = underlying.rows.reduce((sum, row) => sum + BigInt(row.total.replace('.', '')), 0n);
    const units = underlying.rows.reduce((sum, row) => sum + Number(row.units), 0);
    assert.equal(BigInt(day.totalSales.replace('.', '')), cents, `${day.businessDate}: exact sales reconcile`);
    assert.equal(day.completedOrders, underlying.rows.length, `${day.businessDate}: order count reconciles`);
    assert.equal(day.itemsSold, units, `${day.businessDate}: quantities reconcile`);
    rangeCents += cents;
    rangeOrders += underlying.rows.length;
    rangeItems += units;
    const single = await sales.daily(actor.id, shop.id, day.businessDate);
    assert.equal(day.totalSales, single.totalSales, 'Range daily sales match Phase 20');
    assert.equal(day.completedOrders, single.completedOrders);
    assert.equal(day.itemsSold, single.itemsSold);
  }
  assert.equal(BigInt(analytics.totalSales.replace('.', '')), rangeCents);
  assert.equal(analytics.completedOrders, rangeOrders);
  assert.equal(analytics.itemsSold, rangeItems);
  assert.equal(analytics.days[3].totalSales, '0.00');
  assert.equal(analytics.days[3].completedOrders, 0);
  const foreignAnalytics = await sales.dailyAnalytics(actor.id, foreign.id, '2026-10-16', '2026-10-16');
  assert.equal(foreignAnalytics.completedOrders, 1);
  assert.equal(foreignAnalytics.totalSales, '900.00');
  // Weekly boundaries: last Sunday millisecond and exactly Monday midnight in Manila.
  await completed('2026-10-18T15:59:59.999Z', '0.11');
  await completed('2026-10-18T16:00:00.000Z', '0.22');
  await completed('2026-12-31T16:00:00.000Z', '0.33');
  await completed('2027-01-03T15:59:59.999Z', '0.44');
  await completed('2027-01-03T16:00:00.000Z', '0.55');
  await completed('2028-02-29T04:00:00.000Z', '0.66');
  await completed('2028-03-05T16:00:00.000Z', '0.77');
  const weeklyChecks = [];
  for (const [startDate, endDate] of [
    ['2026-10-15', '2026-10-26'],
    ['2026-12-28', '2027-01-10'],
    ['2028-02-28', '2028-03-12'],
  ]) {
    const weekly = await sales.weeklyAnalytics(actor.id, shop.id, startDate, endDate);
    const independent = await client.query(
      `SELECT to_char(date_trunc('week', (o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD') AS monday,
        count(*)::int AS orders, sum(o."totalPrice")::text AS total,
        sum((SELECT coalesce(sum(i.quantity), 0) FROM "${schema}".order_items i WHERE i."shopId"=o."shopId" AND i."orderId"=o.id))::text AS units
       FROM "${schema}".orders o WHERE o."shopId"=$1 AND o.status='CONFIRMED'
         AND o."paymentStatus"='PAID' AND o."preparationStatus"='COMPLETED'
         AND o."completedBy" IS NOT NULL AND o.currency='PHP'
         AND ((o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date
       GROUP BY 1 ORDER BY 1`, [shop.id, startDate, endDate],
    );
    let cents = 0n, count = 0, units = 0;
    for (const week of weekly.weeks) {
      const expectedWeek = independent.rows.find((row) => row.monday === week.weekStart);
      const expectedCents = BigInt((expectedWeek?.total ?? '0.00').replace('.', ''));
      assert.equal(BigInt(week.totalSales.replace('.', '')), expectedCents);
      assert.equal(week.completedOrders, expectedWeek?.orders ?? 0);
      assert.equal(week.itemsSold, Number(expectedWeek?.units ?? 0));
      assert.equal(new Date(`${week.weekStart}T12:00:00Z`).getUTCDay(), 1);
      assert.equal(new Date(`${week.weekEnd}T12:00:00Z`).getUTCDay(), 0);
      cents += expectedCents; count += week.completedOrders; units += week.itemsSold;
    }
    assert.equal(weekly.weeks.filter((week) => week.completedOrders > 0).length, independent.rows.length);
    assert.equal(BigInt(weekly.totalSales.replace('.', '')), cents);
    assert.equal(weekly.completedOrders, count);
    assert.equal(weekly.itemsSold, units);
    weeklyChecks.push({ startDate, endDate, weeks: weekly.weeks });
  }
  // Sunday and Monday fall in different canonical weeks.
  const transition = await sales.weeklyAnalytics(actor.id, shop.id, '2026-10-18', '2026-10-19');
  assert.deepEqual(transition.weeks.map((week) => week.totalSales), ['0.11', '0.22']);
  const foreignWeekly = await sales.weeklyAnalytics(actor.id, foreign.id, '2026-10-12', '2026-10-18');
  assert.equal(foreignWeekly.totalSales, '900.00');
  assert.equal(foreignWeekly.completedOrders, 1);
  // Calendar-month boundaries, including February in leap/non-leap years.
  await completed('2026-10-31T15:59:59.999Z', '1.11');
  await completed('2026-10-31T16:00:00.000Z', '1.22');
  await completed('2026-12-31T15:59:59.999Z', '3.11');
  await completed('2027-02-28T15:59:59.999Z', '1.33');
  await completed('2027-02-28T16:00:00.000Z', '1.44');
  await completed('2028-02-29T15:59:59.999Z', '2.11');
  await completed('2028-02-29T16:00:00.000Z', '2.22');
  const monthlyChecks = [];
  for (const [startDate, endDate] of [
    ['2026-10-15', '2026-12-05'],
    ['2026-12-01', '2027-03-31'],
    ['2028-02-01', '2028-04-30'],
  ]) {
    const monthly = await sales.monthlyAnalytics(actor.id, shop.id, startDate, endDate);
    const independent = await client.query(
      `SELECT to_char(date_trunc('month', (o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila'), 'YYYY-MM') AS month,
        count(*)::int AS orders, sum(o."totalPrice")::text AS total,
        sum((SELECT coalesce(sum(i.quantity), 0) FROM "${schema}".order_items i WHERE i."shopId"=o."shopId" AND i."orderId"=o.id))::text AS units
       FROM "${schema}".orders o WHERE o."shopId"=$1 AND o.status='CONFIRMED'
         AND o."paymentStatus"='PAID' AND o."preparationStatus"='COMPLETED'
         AND o."completedBy" IS NOT NULL AND o.currency='PHP'
         AND ((o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date
       GROUP BY 1 ORDER BY 1`, [shop.id, startDate, endDate],
    );
    let cents = 0n, count = 0, units = 0;
    for (const month of monthly.months) {
      const expectedMonth = independent.rows.find((row) => row.month === month.month);
      const expectedCents = BigInt((expectedMonth?.total ?? '0.00').replace('.', ''));
      assert.equal(BigInt(month.totalSales.replace('.', '')), expectedCents);
      assert.equal(month.completedOrders, expectedMonth?.orders ?? 0);
      assert.equal(month.itemsSold, Number(expectedMonth?.units ?? 0));
      assert.equal(month.monthStart, `${month.month}-01`);
      cents += expectedCents; count += month.completedOrders; units += month.itemsSold;
    }
    assert.equal(monthly.months.filter((month) => month.completedOrders > 0).length, independent.rows.length);
    assert.equal(BigInt(monthly.totalSales.replace('.', '')), cents);
    assert.equal(monthly.completedOrders, count);
    assert.equal(monthly.itemsSold, units);
    const daily = await sales.dailyAnalytics(actor.id, shop.id, startDate, endDate);
    assert.equal(monthly.totalSales, daily.totalSales);
    assert.equal(monthly.completedOrders, daily.completedOrders);
    assert.equal(monthly.itemsSold, daily.itemsSold);
    monthlyChecks.push({ startDate, endDate, months: monthly.months });
  }
  const monthTransition = await sales.monthlyAnalytics(actor.id, shop.id, '2026-10-31', '2026-11-01');
  assert.deepEqual(monthTransition.months.map((month) => month.totalSales), ['1.11', '1.22']);
  const yearTransition = await sales.monthlyAnalytics(actor.id, shop.id, '2026-12-31', '2027-01-01');
  assert.deepEqual(yearTransition.months.map((month) => month.totalSales), ['3.11', '0.33']);
  const leapTransition = await sales.monthlyAnalytics(actor.id, shop.id, '2028-02-29', '2028-03-01');
  assert.deepEqual(leapTransition.months.map((month) => month.totalSales), ['2.77', '2.22']);
  const foreignMonthly = await sales.monthlyAnalytics(actor.id, foreign.id, '2026-10-01', '2026-10-31');
  assert.equal(foreignMonthly.totalSales, '900.00');
  assert.equal(foreignMonthly.completedOrders, 1);
  const customChecks = [];
  for (const [startDate, endDate] of [['2026-10-15', '2026-11-01'], ['2026-10-16', '2026-10-16'], ['2026-12-31', '2027-01-01'], ['2028-02-29', '2028-03-01'], ['2028-04-01', '2028-04-30']]) {
    const custom = await sales.custom(actor.id, shop.id, startDate, endDate);
    const independent = await client.query(
      `SELECT o.id, o."totalPrice"::text AS total, o."paymentMethod", o."completedAt",
        (SELECT coalesce(sum(i.quantity),0)::text FROM "${schema}".order_items i WHERE i."shopId"=o."shopId" AND i."orderId"=o.id) AS units
       FROM "${schema}".orders o WHERE o."shopId"=$1 AND o.status='CONFIRMED'
        AND o."paymentStatus"='PAID' AND o."preparationStatus"='COMPLETED'
        AND o."completedBy" IS NOT NULL AND o.currency='PHP'
        AND ((o."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date
       ORDER BY o."completedAt" DESC, o.id DESC`, [shop.id, startDate, endDate],
    );
    const cents = independent.rows.reduce((n, row) => n + BigInt(row.total.replace('.', '')), 0n);
    assert.equal(BigInt(custom.totalSales.replace('.', '')), cents);
    assert.equal(custom.completedOrders, independent.rows.length);
    assert.equal(custom.itemsSold, independent.rows.reduce((n, row) => n + Number(row.units), 0));
    for (const payment of custom.paymentBreakdown) {
      const paid = independent.rows.filter((row) => row.paymentMethod === payment.paymentMethod);
      assert.equal(payment.orders, paid.length);
      assert.equal(BigInt(payment.totalSales.replace('.', '')), paid.reduce((n, row) => n + BigInt(row.total.replace('.', '')), 0n));
    }
    assert.deepEqual(custom.recentOrders.map((row) => row.id), independent.rows.slice(0, 10).map((row) => row.id));
    const daily = await sales.dailyAnalytics(actor.id, shop.id, startDate, endDate);
    assert.equal(custom.totalSales, daily.totalSales);
    assert.equal(custom.completedOrders, daily.completedOrders);
    assert.equal(custom.itemsSold, daily.itemsSold);
    customChecks.push({ startDate, endDate, totalSales: custom.totalSales, completedOrders: custom.completedOrders, itemsSold: custom.itemsSold, recentOrders: custom.recentOrders.length });
  }
  const foreignCustom = await sales.custom(actor.id, foreign.id, '2026-10-15', '2026-11-01');
  assert.equal(foreignCustom.totalSales, '900.00');
  assert.equal(foreignCustom.completedOrders, 1);
  await prisma.shopMember.update({
    where: { id: membership.id },
    data: { role: 'CASHIER' },
  });
  await assert.rejects(
    sales.daily(actor.id, shop.id, '2026-10-16'),
    (error) => error.getStatus() === 404,
  );
  await assert.rejects(sales.dailyAnalytics(actor.id, shop.id, '2026-10-16', '2026-10-16'), (error) => error.getStatus() === 404);
  await assert.rejects(sales.weeklyAnalytics(actor.id, shop.id, '2026-10-12', '2026-10-18'), (error) => error.getStatus() === 404);
  await assert.rejects(sales.monthlyAnalytics(actor.id, shop.id, '2026-10-01', '2026-10-31'), (error) => error.getStatus() === 404);
  await assert.rejects(sales.custom(actor.id, shop.id, '2026-10-15', '2026-11-01'), (error) => error.getStatus() === 404);
  console.log(
    JSON.stringify({
      passed: true,
      customSales: { passed: true, criterion: 'One selected start/end period applies consistently to summary, item quantities, payments and recent orders', checks: customChecks },
      monthlyAnalytics: { passed: true, criterion: 'Aggregate sales/orders by calendar month in Asia/Manila', checks: monthlyChecks },
      weeklyAnalytics: { passed: true, criterion: 'Aggregate by consistent Monday-Sunday week boundaries in Asia/Manila', checks: weeklyChecks },
      dailyAnalytics: {
        criterion: 'Daily totals reconcile with underlying eligible orders',
        passed: true,
        startDate: analytics.startDate,
        endDate: analytics.endDate,
        days: analytics.days,
        totalSales: analytics.totalSales,
        completedOrders: analytics.completedOrders,
        itemsSold: analytics.itemsSold,
      },
      criterion: 'Metric matches filtered underlying orders',
      businessDate: '2026-10-16',
      timezone: report.timezone,
      matchedOrders: rows.length,
      itemsSold: report.itemsSold,
      recentOrders: report.recentOrders.length,
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
