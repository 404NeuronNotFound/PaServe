import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';

// Concurrent sessions require committed fixtures. All objects live in this
// uniquely named test schema, which is dropped in finally; public data is untouched.
const schema = `phase11_concurrency_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^phase11_concurrency_[0-9a-f]{32}$/);
const q = (name) => `"${schema}"."${name}"`;
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;
let prisma;
try {
  await setup.connect();
  await setup.query('BEGIN');
  await setup.query(`CREATE SCHEMA "${schema}"`);
  // Copy current table definitions, never business rows. A Phase 11-only schema
  // becomes stale as checkout adds receipt/payment columns. Migration/FK/RLS
  // verification lives in the dedicated database checks; this isolates locking.
  for (const name of ['shops', 'restaurant_tables', 'products', 'orders', 'order_items'])
    await setup.query(`CREATE TABLE ${q(name)} (LIKE public."${name}" INCLUDING ALL)`);
  // Prisma qualifies enum inputs using its configured schema. LIKE retains the
  // public enum type, so rebind order mode to an equivalent private enum.
  await setup.query(`CREATE TYPE ${q('OrderMode')} AS ENUM ('DINE_IN', 'TAKEOUT')`);
  await setup.query(`ALTER TABLE ${q('orders')} ALTER COLUMN "mode" DROP DEFAULT`);
  await setup.query(`ALTER TABLE ${q('orders')} ALTER COLUMN "mode" TYPE ${q('OrderMode')} USING "mode"::text::${q('OrderMode')}`);
  await setup.query(`ALTER TABLE ${q('orders')} ALTER COLUMN "mode" SET DEFAULT 'DINE_IN'`);
  const shopId = randomUUID();
  const productId = randomUUID();
  const slug = `concurrency-${randomUUID()}`;
  await setup.query(`INSERT INTO ${q('shops')} ("id", "slug", "name", "updatedAt") VALUES ($1,$2,'Concurrency fixture',CURRENT_TIMESTAMP)`, [
    shopId,
    slug,
  ]);
  await setup.query(
    `INSERT INTO ${q('products')} ("id", "shopId", "name", "slug", "price", "updatedAt") VALUES ($1,$2,'Concurrency fixture','fixture',1.00,CURRENT_TIMESTAMP)`,
    [productId, shopId],
  );
  await setup.query('COMMIT');
  created = true;
  prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        max: 6,
        options: `-c search_path=${schema}`,
      },
      { schema },
    ),
  });
  const config = new ConfigService();
  // Pricing is covered by the real-repository pricing check; this check isolates
  // real transaction/locking behavior with a fixed server-owned price quote.
  const orders = new OrdersService(
    prisma,
    {
      quote: async (_slug, id, selection) => ({
        productId: id,
        productName: 'Concurrency fixture',
        currency: 'PHP',
        basePrice: '1.00',
        unitPrice: '1.00',
        totalPrice: '1.00',
        quantity: selection.quantity,
        variants: [],
        addOns: [],
      }),
    },
    new TableContextService(config),
    new OrderTokenService(config),
  );
  const body = () => ({
    requestId: randomUUID(),
    mode: 'TAKEOUT',
    items: [{ productId, quantity: 1, variantIds: [], addOnIds: [] }],
  });
  let conflicts = 0;
  const submit = async (request) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await orders.create(slug, request);
      } catch (error) {
        if (
          error.getStatus?.() !== 409 ||
          error.getResponse?.().code !== 'ORDER_RETRY_REQUIRED'
        ) {
          throw new Error(
            `Concurrent submission returned an unexpected error: ${error.code ?? error.getResponse?.().code ?? error.name}; metadata keys: ${Object.keys(error.meta ?? {}).join(',')}; database code: ${error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode ?? 'none'}`,
          );
        }
        conflicts++;
        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 150),
        );
      }
    }
    throw new Error('Concurrent submission exhausted retries.');
  };
  const submitAll = async (requests) => {
    // Settle every session before cleanup, including when an assertion fails.
    const outcomes = await Promise.allSettled(requests.map(submit));
    const failure = outcomes.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    return outcomes.map((result) => result.value);
  };
  const requests = Array.from({ length: 3 }, body);
  const results = await submitAll(requests);
  assert.equal(new Set(results.map((result) => result.order.id)).size, 3);
  assert.deepEqual(
    results
      .map((result) => result.order.orderNumber)
      .sort((a, b) => a.localeCompare(b)),
    ['ORD-000001', 'ORD-000002', 'ORD-000003'],
  );
  const identical = body();
  const replays = await submitAll(Array.from({ length: 3 }, () => identical));
  assert.equal(new Set(replays.map((result) => result.order.id)).size, 1);
  assert.equal(new Set(replays.map((result) => result.order.qrToken)).size, 1);
  assert.equal(await prisma.order.count({ where: { shopId } }), 4);
  assert.equal(await prisma.orderItem.count({ where: { shopId } }), 4);
  assert.equal(
    (
      await prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: { lastOrderNumber: true },
      })
    ).lastOrderNumber,
    4n,
  );
  console.log(
    `Concurrent order checks passed: distinct numbers, atomic items/counters, same-request deduplication and stable QR tokens (${conflicts} safe retries).`,
  );
} finally {
  await prisma?.$disconnect();
  if (created) {
    // Validate the exact private namespace before any cascading cleanup.
    assert.match(schema, /^phase11_concurrency_[0-9a-f]{32}$/);
    await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
  } else {
    await setup.query('ROLLBACK').catch(() => {});
  }
  const leftover = await setup.query(
    'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1',
    [schema],
  );
  assert.equal(leftover.rows[0].count, 0);
  await setup.end();
}
