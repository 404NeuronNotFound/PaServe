import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';

// Exercise the exact migration in an isolated schema; all DDL/fixtures roll back.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const schema = `dine_in_check_${randomUUID().replaceAll('-', '')}`;
const q = (name) => `"${schema}"."${name}"`;
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(
    `CREATE TABLE ${q('shops')} ("id" TEXT PRIMARY KEY, "slug" TEXT UNIQUE, "isActive" BOOLEAN NOT NULL DEFAULT true)`,
  );
  const intakeMigration = await readFile(
    new URL(
      '../prisma/migrations/20261012170000_shop_accepting_orders/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(intakeMigration.replace(/"shops"/g, q('shops')));
  await client.query(
    `CREATE TABLE ${q('restaurant_tables')} ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL REFERENCES ${q('shops')}("id"), "code" TEXT, "number" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true)`,
  );
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261012090000_dine_in_orders/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    migration.replace(
      /"(orders|shops|restaurant_tables|OrderMode)"/g,
      (_match, name) => q(name),
    ),
  );
  for (const path of [
    '20261012140000_takeout_mode',
    '20261012140100_takeout_order_tables',
  ]) {
    const upgrade = await readFile(
      new URL(`../prisma/migrations/${path}/migration.sql`, import.meta.url),
      'utf8',
    );
    await client.query(
      upgrade.replace(/"(orders|OrderMode)"/g, (_match, name) => q(name)),
    );
  }
  await client.query(
    `INSERT INTO ${q('shops')} ("id", "slug") VALUES ('a', 'cafe-a'), ('b', 'cafe-b')`,
  );
  await client.query(
    `INSERT INTO ${q('restaurant_tables')} ("id", "shopId", "code", "number") VALUES ('table-a', 'a', 'T12', 'Patio 4'), ('table-b', 'b', 'T12', '12')`,
  );
  const insert = (id, shop, table, request, total = '20.02', items = '[{}]') =>
    client.query(
      `INSERT INTO ${q('orders')} ("id", "shopId", "tableId", "requestId", "requestHash", "tableCode", "tableNumber", "totalPrice", "items") VALUES ($1,$2,$3,$4,'hash','T12','Patio 4',$5,$6) RETURNING *`,
      [id, shop, table, request, total, items],
    );
  const result = await insert('order-a', 'a', 'table-a', 'request-a');
  assert.equal(result.rows[0].mode, 'DINE_IN');
  assert.equal(result.rows[0].tableId, 'table-a');
  assert.equal(result.rows[0].totalPrice, '20.02');
  assert.equal(result.rows[0].status, 'PLACED');
  const pendingMigration = await readFile(
    new URL(
      '../prisma/migrations/20261012160000_pending_order_status/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(pendingMigration.replace(/"orders"/g, q('orders')));
  assert.equal(
    (
      await client.query(
        `SELECT "status" FROM ${q('orders')} WHERE "id" = 'order-a'`,
      )
    ).rows[0].status,
    'PENDING',
  );
  async function rejects(action, code) {
    await client.query('SAVEPOINT invalid_order');
    await assert.rejects(action, (error) => error.code === code);
    await client.query('ROLLBACK TO SAVEPOINT invalid_order');
  }
  await rejects(() => insert('foreign', 'a', 'table-b', 'foreign'), '23503');
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "status" = 'PLACED' WHERE "id" = 'order-a'`,
      ),
    '23514',
  );
  await rejects(
    () => insert('duplicate', 'a', 'table-a', 'request-a'),
    '23505',
  );
  await rejects(
    () => insert('negative', 'a', 'table-a', 'negative', '-0.01'),
    '23514',
  );
  await rejects(
    () => insert('empty', 'a', 'table-a', 'empty', '0.00', '[]'),
    '23514',
  );
  await rejects(
    () =>
      client.query(
        `DELETE FROM ${q('restaurant_tables')} WHERE "id" = 'table-a'`,
      ),
    '23503',
  );
  await insert('order-b', 'b', 'table-b', 'request-a');
  const {
    rows: [security],
  } = await client.query(
    `SELECT c.relrowsecurity AS rls,
    has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
    has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'orders'`,
    [schema],
  );
  assert.deepEqual(security, {
    rls: true,
    anon_access: false,
    browser_access: false,
  });
  const parentMigration = await readFile(
    new URL(
      '../prisma/migrations/20261012180000_parent_order_metadata/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(
    parentMigration.replace(/"(shops|orders)"/g, (_match, name) => q(name)),
  );
  const parent = (
    await client.query(
      `SELECT "orderNumber", "paymentStatus", "updatedAt", "qrTokenNonce" FROM ${q('orders')} WHERE "id" = 'order-a'`,
    )
  ).rows[0];
  assert.equal(parent.orderNumber, 'ORD-000001');
  assert.equal(parent.paymentStatus, 'UNPAID');
  assert.ok(parent.updatedAt);
  assert.match(parent.qrTokenNonce, /^[0-9a-f-]{36}$/);
  // Run the actual service's tagged SQL through pg in this rollback-only schema.
  // Prisma product/order delegates are adapted; table resolution uses service SQL unchanged.
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(
    `CREATE TABLE ${q('products')} ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL REFERENCES ${q('shops')}("id"), "status" TEXT NOT NULL DEFAULT 'AVAILABLE', "isArchived" BOOLEAN NOT NULL DEFAULT false)`,
  );
  await client.query(
    `INSERT INTO ${q('products')} ("id", "shopId") VALUES ('coffee-a', 'a'), ('coffee-b', 'b')`,
  );
  await client.query(
    `INSERT INTO ${q('restaurant_tables')} ("id", "shopId", "code", "number", "isActive") VALUES ('inactive-a', 'a', 'T13', '13', false), ('foreign-b', 'b', 'T14', '14', true)`,
  );
  const tx = {
    shop: {
      update: async ({ where }) => {
        const row = (
          await client.query(
            `UPDATE ${q('shops')} SET "lastOrderNumber" = "lastOrderNumber" + 1 WHERE "id" = $1 AND "isActive" = true AND "acceptingOrders" = true RETURNING "lastOrderNumber"`,
            [where.id],
          )
        ).rows[0];
        return { lastOrderNumber: BigInt(row.lastOrderNumber) };
      },
    },
    product: {
      findMany: async ({ where }) =>
        (
          await client.query(
            `SELECT "id", "status", "isArchived" FROM ${q('products')} WHERE "shopId" = $1 AND "id" = ANY($2::text[])`,
            [where.shopId, where.id.in],
          )
        ).rows,
    },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.reduce(
        (text, part, index) =>
          text + part + (index < values.length ? `$${index + 1}` : ''),
        '',
      );
      return (await client.query(sql, values)).rows;
    },
    order: {
      findUnique: async ({ where }) => {
        const row = (
          await client.query(
            `SELECT * FROM ${q('orders')} WHERE "shopId" = $1 AND "requestId" = $2`,
            [where.shopId_requestId.shopId, where.shopId_requestId.requestId],
          )
        ).rows[0];
        return row
          ? { ...row, totalPrice: new Prisma.Decimal(row.totalPrice) }
          : null;
      },
      create: async ({ data }) => {
        const fields = [
          'id',
          'shopId',
          'tableId',
          'requestId',
          'requestHash',
          'mode',
          'status',
          'paymentStatus',
          'orderNumber',
          'qrTokenNonce',
          'qrTokenExpiresAt',
          'qrTokenRevokedAt',
          'createdAt',
          'updatedAt',
          'tableCode',
          'tableNumber',
          'currency',
          'totalPrice',
          'items',
        ];
        const values = fields.map((field) =>
          field === 'id'
            ? randomUUID()
            : field === 'items'
              ? JSON.stringify(data.items)
              : field === 'totalPrice'
                ? data.totalPrice.toFixed(2)
                : data[field],
        );
        const row = (
          await client.query(
            `INSERT INTO ${q('orders')} (${fields.map((field) => `"${field}"`).join(',')}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(',')}) RETURNING *`,
            values,
          )
        ).rows[0];
        return { ...row, totalPrice: new Prisma.Decimal(row.totalPrice) };
      },
    },
  };
  let quotes = 0;
  const products = {
    quote: async () => {
      quotes++;
      return {
        productId: 'coffee',
        productName: 'Coffee',
        quantity: 2,
        currency: 'PHP',
        basePrice: '10.01',
        unitPrice: '10.01',
        totalPrice: '20.02',
        variants: [],
        addOns: [],
      };
    },
  };
  const contexts = new TableContextService(new ConfigService());
  const service = new OrdersService(
    { $transaction: (callback) => callback(tx) },
    products,
    contexts,
    new OrderTokenService(new ConfigService()),
  );
  const submit = (slug, tableCode) =>
    service.create(slug, {
      requestId: randomUUID(),
      tableCode,
      tableToken: contexts.issue(slug, tableCode),
      items: [
        {
          productId: slug === 'cafe-a' ? 'coffee-a' : 'coffee-b',
          quantity: 2,
          variantIds: [],
          addOnIds: [],
        },
      ],
    });
  const accepted = await submit('cafe-a', 'T12');
  assert.equal(accepted.order.orderNumber, 'ORD-000002');
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "orderNumber" = 'ORD-000001' WHERE "id" = $1`,
        [accepted.order.id],
      ),
    '23505',
  );
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "paymentStatus" = 'PAID' WHERE "id" = $1`,
        [accepted.order.id],
      ),
    '23514',
  );
  assert.equal(accepted.order.table.number, 'Patio 4');
  assert.equal(accepted.order.status, 'PENDING');
  const {
    rows: [binding],
  } = await client.query(
    `SELECT "shopId", "tableId" FROM ${q('orders')} WHERE "id" = $1`,
    [accepted.order.id],
  );
  assert.deepEqual(binding, { shopId: 'a', tableId: 'table-a' });
  const acceptedB = await submit('cafe-b', 'T12');
  // Both shops have one backfilled legacy order; numbering is independent per shop.
  assert.equal(acceptedB.order.orderNumber, 'ORD-000002');
  assert.equal(acceptedB.order.table.number, '12');
  const pickupRequest = {
    requestId: randomUUID(),
    mode: 'TAKEOUT',
    items: [
      { productId: 'coffee-a', quantity: 2, variantIds: [], addOnIds: [] },
    ],
  };
  const pickup = await service.create('cafe-a', pickupRequest);
  assert.equal(pickup.order.mode, 'TAKEOUT');
  assert.equal(pickup.order.status, 'PENDING');
  assert.equal(pickup.order.table, null);
  const {
    rows: [pickupBinding],
  } = await client.query(
    `SELECT "shopId", "mode", "tableId", "tableCode", "tableNumber" FROM ${q('orders')} WHERE "id" = $1`,
    [pickup.order.id],
  );
  assert.deepEqual(pickupBinding, {
    shopId: 'a',
    mode: 'TAKEOUT',
    tableId: null,
    tableCode: null,
    tableNumber: null,
  });
  assert.equal(
    (await service.create('cafe-a', pickupRequest)).order.id,
    pickup.order.id,
  );
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "tableId" = 'table-a' WHERE "id" = $1`,
        [pickup.order.id],
      ),
    '23514',
  );
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "tableId" = NULL WHERE "id" = $1`,
        [accepted.order.id],
      ),
    '23514',
  );
  await rejects(
    () =>
      client.query(
        `UPDATE ${q('orders')} SET "mode" = 'DINE_IN' WHERE "id" = $1`,
        [pickup.order.id],
      ),
    '23514',
  );
  await assert.rejects(
    () => service.create('cafe-a', { ...pickupRequest, tableCode: 'T12' }),
    (error) => error.status === 400,
  );
  const before = await client.query(`SELECT count(*) FROM ${q('orders')}`);
  const quotesBefore = quotes;
  const tampered = (slug, code) =>
    service.create(slug, {
      requestId: randomUUID(),
      tableCode: code,
      tableToken: contexts.issue('cafe-a', 'T12'),
      items: [
        { productId: randomUUID(), quantity: 2, variantIds: [], addOnIds: [] },
      ],
    });
  await assert.rejects(
    () => tampered('cafe-b', 'T12'),
    (error) =>
      error.status === 403 && error.response.code === 'TABLE_CONTEXT_INVALID',
  );
  await assert.rejects(
    () => tampered('cafe-a', 'T14'),
    (error) =>
      error.status === 403 && error.response.code === 'TABLE_CONTEXT_INVALID',
  );
  for (const code of ['T13', 'T14', 'T99']) {
    await assert.rejects(
      () => submit('cafe-a', code),
      (error) =>
        error.status === 404 && error.response.code === 'TABLE_NOT_AVAILABLE',
    );
  }
  await client.query(
    `UPDATE ${q('restaurant_tables')} SET "isActive" = false WHERE "id" = 'table-a'`,
  );
  await assert.rejects(
    () => submit('cafe-a', 'T12'),
    (error) => error.status === 404,
  );
  await client.query(
    `UPDATE ${q('shops')} SET "isActive" = false WHERE "id" = 'b'`,
  );
  await assert.rejects(
    () => submit('cafe-b', 'T12'),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () =>
      service.create('cafe-b', { ...pickupRequest, requestId: randomUUID() }),
    (error) =>
      error.status === 404 && error.response.code === 'SHOP_NOT_AVAILABLE',
  );
  assert.equal(quotes, quotesBefore);
  assert.deepEqual(
    (await client.query(`SELECT count(*) FROM ${q('orders')}`)).rows,
    before.rows,
  );
  console.log(
    'Order checks passed: takeout persists without table fields, replays safely and rejects table binding; dine-in requires an active same-shop table. Mode/table constraints, tenant isolation and RLS pass. All DDL/fixtures roll back.',
  );
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
