import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OrdersService } from '../dist/modules/orders/orders.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';

// Exercise the exact migration in an isolated schema; all DDL/fixtures roll back.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const schema = `dine_in_check_${randomUUID().replaceAll('-', '')}`;
const q = name => `"${schema}"."${name}"`;
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`CREATE TABLE ${q('shops')} ("id" TEXT PRIMARY KEY, "slug" TEXT UNIQUE, "isActive" BOOLEAN NOT NULL DEFAULT true)`);
  await client.query(`CREATE TABLE ${q('restaurant_tables')} ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL REFERENCES ${q('shops')}("id"), "code" TEXT, "number" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true)`);
  const migration = await readFile(new URL('../prisma/migrations/20261012090000_dine_in_orders/migration.sql', import.meta.url), 'utf8');
  await client.query(migration.replace(/"(orders|shops|restaurant_tables|OrderMode)"/g, (_match, name) => q(name)));
  await client.query(`INSERT INTO ${q('shops')} ("id", "slug") VALUES ('a', 'cafe-a'), ('b', 'cafe-b')`);
  await client.query(`INSERT INTO ${q('restaurant_tables')} ("id", "shopId", "code", "number") VALUES ('table-a', 'a', 'T12', 'Patio 4'), ('table-b', 'b', 'T12', '12')`);
  const insert = (id, shop, table, request, total = '20.02', items = '[{}]') => client.query(`INSERT INTO ${q('orders')} ("id", "shopId", "tableId", "requestId", "requestHash", "tableCode", "tableNumber", "totalPrice", "items") VALUES ($1,$2,$3,$4,'hash','T12','Patio 4',$5,$6) RETURNING *`, [id, shop, table, request, total, items]);
  const result = await insert('order-a', 'a', 'table-a', 'request-a');
  assert.equal(result.rows[0].mode, 'DINE_IN');
  assert.equal(result.rows[0].tableId, 'table-a');
  assert.equal(result.rows[0].totalPrice, '20.02');
  async function rejects(action, code) {
    await client.query('SAVEPOINT invalid_order');
    await assert.rejects(action, error => error.code === code);
    await client.query('ROLLBACK TO SAVEPOINT invalid_order');
  }
  await rejects(() => insert('foreign', 'a', 'table-b', 'foreign'), '23503');
  await rejects(() => insert('duplicate', 'a', 'table-a', 'request-a'), '23505');
  await rejects(() => insert('negative', 'a', 'table-a', 'negative', '-0.01'), '23514');
  await rejects(() => insert('empty', 'a', 'table-a', 'empty', '0.00', '[]'), '23514');
  await rejects(() => client.query(`DELETE FROM ${q('restaurant_tables')} WHERE "id" = 'table-a'`), '23503');
  await insert('order-b', 'b', 'table-b', 'request-a');
  const { rows: [security] } = await client.query(`SELECT c.relrowsecurity AS rls,
    has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
    has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'orders'`, [schema]);
  assert.deepEqual(security, { rls: true, anon_access: false, browser_access: false });
  // Run the actual service's tagged SQL through pg in this rollback-only schema.
  // Only Prisma's order delegate is adapted; table resolution uses service SQL unchanged.
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(`INSERT INTO ${q('restaurant_tables')} ("id", "shopId", "code", "number", "isActive") VALUES ('inactive-a', 'a', 'T13', '13', false), ('foreign-b', 'b', 'T14', '14', true)`);
  const tx = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
      return (await client.query(sql, values)).rows;
    },
    order: {
      findUnique: async ({ where }) => (await client.query(`SELECT * FROM ${q('orders')} WHERE "shopId" = $1 AND "requestId" = $2`, [where.shopId_requestId.shopId, where.shopId_requestId.requestId])).rows[0] ?? null,
      create: async ({ data }) => {
        const fields = ['id', 'shopId', 'tableId', 'requestId', 'requestHash', 'mode', 'tableCode', 'tableNumber', 'currency', 'totalPrice', 'items'];
        const values = fields.map(field => field === 'id' ? randomUUID() : field === 'items' ? JSON.stringify(data.items) : field === 'totalPrice' ? data.totalPrice.toFixed(2) : data[field]);
        const row = (await client.query(`INSERT INTO ${q('orders')} (${fields.map(field => `"${field}"`).join(',')}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(',')}) RETURNING *`, values)).rows[0];
        return { ...row, totalPrice: new Prisma.Decimal(row.totalPrice) };
      },
    },
  };
  let quotes = 0;
  const products = { quote: async () => {
    quotes++;
    return { productId: 'coffee', productName: 'Coffee', quantity: 2, currency: 'PHP', basePrice: '10.01', unitPrice: '10.01', totalPrice: '20.02', variants: [], addOns: [] };
  } };
  const service = new OrdersService({ $transaction: callback => callback(tx) }, products);
  const submit = (slug, tableCode) => service.create(slug, { requestId: randomUUID(), tableCode, items: [{ productId: randomUUID(), quantity: 2, variantIds: [], addOnIds: [] }] });
  const accepted = await submit('cafe-a', 'T12');
  assert.equal(accepted.order.table.number, 'Patio 4');
  const { rows: [binding] } = await client.query(`SELECT "shopId", "tableId" FROM ${q('orders')} WHERE "id" = $1`, [accepted.order.id]);
  assert.deepEqual(binding, { shopId: 'a', tableId: 'table-a' });
  const acceptedB = await submit('cafe-b', 'T12');
  assert.equal(acceptedB.order.table.number, '12');
  const before = await client.query(`SELECT count(*) FROM ${q('orders')}`);
  const quotesBefore = quotes;
  for (const code of ['T13', 'T14', 'T99']) {
    await assert.rejects(() => submit('cafe-a', code), error => error.status === 404 && error.response.code === 'TABLE_NOT_AVAILABLE');
  }
  await client.query(`UPDATE ${q('restaurant_tables')} SET "isActive" = false WHERE "id" = 'table-a'`);
  await assert.rejects(() => submit('cafe-a', 'T12'), error => error.status === 404);
  await client.query(`UPDATE ${q('shops')} SET "isActive" = false WHERE "id" = 'b'`);
  await assert.rejects(() => submit('cafe-b', 'T12'), error => error.status === 404);
  assert.equal(quotes, quotesBefore);
  assert.deepEqual((await client.query(`SELECT count(*) FROM ${q('orders')}`)).rows, before.rows);
  console.log('Dine-in checks passed: actual service SQL accepts active same-shop tables, isolates shared codes and rejects inactive, foreign, nonexistent, deactivated tables and inactive shops without pricing or insertion. Migration constraints and RLS pass. All DDL/fixtures roll back.');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
