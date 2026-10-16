// Real Phase 19 service queries against private copies of the installed schema.
// All DDL/data are rolled back. No production table, trigger or migration changes.
import 'dotenv/config';
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { ActiveOrdersService } from '../dist/modules/orders/active-orders.service.js';
import { CompletedOrdersService } from '../dist/modules/orders/completed-orders.service.js';
import { CancelledOrdersService } from '../dist/modules/orders/cancelled-orders.service.js';
import { OwnerOrderDetailsService } from '../dist/modules/orders/owner-order-details.service.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { CompletedSalesService } from '../dist/modules/orders/completed-sales.service.js';
import { PreparationQueueService } from '../dist/modules/orders/preparation-queue.service.js';
import { PreparationStartService } from '../dist/modules/orders/preparation-start.service.js';
import { PreparationReadyService } from '../dist/modules/orders/preparation-ready.service.js';
import { PreparationCompleteService } from '../dist/modules/orders/preparation-complete.service.js';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
const schema = `phase19_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^phase19_[a-f0-9]{32}$/);
const pool = new pg.Pool({
  connectionString: 'postgres://unused:unused@127.0.0.1:1/unused',
});
// Pin Prisma and fixture DDL to one connection/transaction. Queries are genuine SQL.
pool.query = (query) => client.query(query);
pool.connect = async () => {
  throw new Error('Only the rollback fixture connection may be used');
};
const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
let transaction = false;
let connected = false;
try {
  await client.connect();
  connected = true;
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('orders','order_items','shop_members')`,
  );
  for (const [table, column] of [
    ['orders', 'completedAt'],
    ['orders', 'shopDetailsSnapshot'],
    ['orders', 'paymentMethod'],
    ['order_items', 'lineTotalSnapshot'],
    ['shop_members', 'role'],
  ]) {
    if (
      !rows.some(
        (row) => row.table_name === table && row.column_name === column,
      )
    )
      throw Object.assign(new Error('Missing Phase 19 prerequisite column'), {
        code: 'PHASE19_SCHEMA_NOT_READY',
      });
  }
  const security = await client.query(
    `SELECT c.relname, c.relrowsecurity, has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('orders','order_items')`,
  );
  assert.equal(security.rowCount, 2);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true, 'Order data retains RLS');
    assert.equal(
      row.anon_access,
      false,
      'Anonymous direct table access stays revoked',
    );
    assert.equal(
      row.browser_access,
      false,
      'Authenticated direct browser table access stays revoked',
    );
  }
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
  ])
    await client.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );
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
    data: { email: 'phase19@example.com', passwordHash: 'unused-test-hash' },
  });
  const shop = await prisma.shop.create({
    data: { name: 'Phase 19 fixture', slug: 'phase19-main' },
  });
  const foreign = await prisma.shop.create({
    data: { name: 'Foreign fixture', slug: 'phase19-foreign' },
  });
  const membership = await prisma.shopMember.create({
    data: { userId: actor.id, shopId: shop.id, role: 'OWNER' },
  });
  await prisma.shopMember.create({
    data: { userId: actor.id, shopId: foreign.id, role: 'OWNER' },
  });
  const members = new ShopMembersService(new ShopMembersRepository(prisma));
  const active = new ActiveOrdersService(prisma, members),
    completed = new CompletedOrdersService(prisma, members),
    cancelled = new CancelledOrdersService(prisma, members),
    details = new OwnerOrderDetailsService(prisma, members);
  const base = new Date('2026-10-16T00:00:00.000Z');
  const orderData = (number, target = shop.id) => ({
    id: randomUUID(),
    shopId: target,
    requestId: randomUUID(),
    requestHash: 'a'.repeat(64),
    orderNumber: `ORD-${String(number).padStart(6, '0')}`,
    mode: 'DINE_IN',
    tableId: randomUUID(),
    tableCode: 'saved-table-code',
    tableNumber: 'Patio %_\\',
    currency: 'PHP',
    totalPrice: '36.00',
    items: [{ productId: randomUUID(), quantity: 2 }],
    qrTokenNonce: randomUUID(),
    qrTokenExpiresAt: new Date('2099-01-01T00:00:00Z'),
    createdAt: base,
  });
  for (let start = 1; start <= 5000; start += 500)
    await prisma.order.createMany({
      data: Array.from({ length: 500 }, (_, index) => orderData(start + index)),
    });
  const first = await active.list(actor.id, shop.id);
  assert.equal(first.orders.length, 25);
  assert.ok(first.nextCursor);
  const second = await active.list(actor.id, shop.id, first.nextCursor);
  assert.equal(
    new Set([...first.orders, ...second.orders].map((order) => order.id)).size,
    50,
    'Tie-time cursor pages do not duplicate orders',
  );
  const literal = await active.list(actor.id, shop.id, undefined, '%_\\', {
    mode: 'DINE_IN',
    table: 'patio %_\\',
    from: '2026-10-16',
    to: '2026-10-16',
  });
  assert.equal(literal.orders.length, 25);
  assert.equal(
    (
      await active.list(actor.id, shop.id, undefined, undefined, {
        from: '2026-10-17',
      })
    ).orders.length,
    0,
  );
  assert.equal(
    (
      await active.list(actor.id, shop.id, undefined, undefined, {
        table: 'Patio XYZ',
      })
    ).orders.length,
    0,
  );
  const foreignOrder = await prisma.order.create({
    data: orderData(1, foreign.id),
  });
  await assert.rejects(
    details.get(actor.id, shop.id, foreignOrder.id),
    (error) => error.getStatus() === 404,
  );
  assert.equal((await active.list(actor.id, foreign.id)).orders.length, 1);
  const unicodeLabel = '𠮷'.repeat(40);
  await prisma.order.update({
    where: { id: foreignOrder.id },
    data: { tableNumber: unicodeLabel },
  });
  assert.equal(
    (
      await active.list(actor.id, foreign.id, undefined, undefined, {
        table: unicodeLabel,
      })
    ).orders[0].id,
    foreignOrder.id,
  );
  const paidData = (number, stage) => ({
    ...orderData(number),
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRequestId: randomUUID(),
    paymentReviewVersion: 'b'.repeat(64),
    amountReceived: '50.00',
    changeDue: '14.00',
    decidedAt: base,
    decidedBy: actor.id,
    qrTokenRevokedAt: base,
    paidAt: base,
    paidBy: actor.id,
    preparationStatus: stage,
    queuedAt: base,
  });
  const kitchenOrder = await prisma.order.create({
    data: paidData(5001, 'QUEUED'),
  });
  const snapshot = {
    productId: randomUUID(),
    productName: 'Original coffee',
    currency: 'PHP',
    quantity: 2,
    basePrice: '10.00',
    unitPrice: '18.00',
    totalPrice: '36.00',
    notes: 'Less ice',
    variants: [
      {
        id: randomUUID(),
        name: 'Large',
        optionGroupId: randomUUID(),
        isDefault: false,
        priceAdjustment: '5.00',
      },
    ],
    addOns: [{ id: randomUUID(), name: 'Oat milk', priceAdjustment: '3.00' }],
  };
  await prisma.orderItem.create({
    data: {
      shopId: shop.id,
      orderId: kitchenOrder.id,
      lineNumber: 1,
      quantity: 2,
      notes: snapshot.notes,
      snapshot,
      productSnapshotId: snapshot.productId,
      productNameSnapshot: snapshot.productName,
      basePriceSnapshot: snapshot.basePrice,
      unitPriceSnapshot: snapshot.unitPrice,
      lineTotalSnapshot: snapshot.totalPrice,
      variantsSnapshot: snapshot.variants,
      addOnsSnapshot: snapshot.addOns,
    },
  });
  const queue = new PreparationQueueService(prisma);
  assert.deepEqual(
    (await details.get(actor.id, shop.id, kitchenOrder.id)).order.items,
    (await queue.list(actor.id, shop.id)).orders[0].items,
  );
  const transactional = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') return (callback) => callback(prisma);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const startService = new PreparationStartService(transactional),
    readyService = new PreparationReadyService(transactional),
    completeService = new PreparationCompleteService(transactional);
  await assert.rejects(
    completeService.complete(actor.id, shop.id, kitchenOrder.id),
    (error) => error.getStatus() === 409,
  );
  await startService.start(actor.id, shop.id, kitchenOrder.id);
  assert.equal(
    (await startService.start(actor.id, shop.id, kitchenOrder.id))
      .alreadyStarted,
    true,
  );
  await readyService.ready(actor.id, shop.id, kitchenOrder.id);
  await completeService.complete(actor.id, shop.id, kitchenOrder.id);
  assert.equal(
    (await completeService.complete(actor.id, shop.id, kitchenOrder.id))
      .alreadyCompleted,
    true,
  );
  const rejected = await prisma.order.create({
    data: {
      ...orderData(5002),
      status: 'REJECTED',
      decidedAt: base,
      decidedBy: actor.id,
      qrTokenRevokedAt: base,
      rejectionReason: 'Out of stock',
    },
  });
  assert.equal(
    (await cancelled.list(actor.id, shop.id)).orders[0].id,
    rejected.id,
  );
  const history = await completed.list(actor.id, shop.id);
  assert.equal(history.orders[0].id, kitchenOrder.id);
  const savedDetails = (await details.get(actor.id, shop.id, kitchenOrder.id))
    .order;
  assert.deepEqual(savedDetails.items, [snapshot]);
  assert.deepEqual(savedDetails.permittedActions, ['RECEIPT']);
  assert.equal(savedDetails.totalPrice, history.orders[0].totalPrice);
  assert.equal(savedDetails.completedAt, history.orders[0].completedAt);
  const sales = await new CompletedSalesService(prisma).summary(
    actor.id,
    shop.id,
    '2026-10-16T00:00:00Z',
    '2026-10-17T00:00:00Z',
  );
  assert.equal(sales.completedOrders, 1);
  assert.equal(sales.totalSales, '36.00');
  const activeIds = (await active.list(actor.id, shop.id)).orders.map(
    (order) => order.id,
  );
  assert.ok(
    !activeIds.includes(kitchenOrder.id) && !activeIds.includes(rejected.id),
  );
  await prisma.shopMember.update({
    where: { id: membership.id },
    data: { role: 'CASHIER' },
  });
  await assert.rejects(
    active.list(actor.id, shop.id),
    (error) => error.getStatus() === 403,
  );
  await assert.rejects(
    details.get(actor.id, shop.id, kitchenOrder.id),
    (error) => error.getStatus() === 403,
  );
  await prisma.shopMember.update({
    where: { id: membership.id },
    data: { role: 'OWNER' },
  });
  const samples = [];
  for (let index = 0; index < 10; index++) {
    const at = performance.now();
    await active.list(actor.id, shop.id, undefined, 'ORD-004999', {
      table: 'Patio %_\\',
    });
    samples.push(performance.now() - at);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      passed: true,
      fixtureOrders: 5003,
      checks:
        'Tenant isolation, tie-time pagination, literal search/table, combined dates, live ownership revocation, detail/kitchen snapshots, guarded preparation transitions and replay, completed/rejected separation, exact sales exclusion',
      searchMs: {
        median: Math.round(samples[5]),
        max: Math.round(samples[9]),
        samples: 10,
      },
      scope:
        'Private copies of installed schema in one rollback-only transaction; smoke timings are not a production SLA',
    }),
  );
} catch (error) {
  console.error(
    'Phase 19 database check failed:',
    error.code ?? error.name,
    String(error.message)
      .replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
      .slice(0, 1400),
  );
  process.exitCode = 1;
} finally {
  if (transaction) await client.query('ROLLBACK');
  const remaining = connected
    ? await client
        .query(
          'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1',
          [schema],
        )
        .catch(() => null)
    : null;
  if (remaining)
    assert.equal(
      remaining.rows[0].count,
      0,
      'Fixture namespace must not survive rollback',
    );
  await prisma.$disconnect();
  await pool.end();
  await client.end();
}
