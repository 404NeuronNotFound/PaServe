import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Validate the exact migration without changing application tables or keeping fixtures.
const schema = `service_check_${randomUUID().replaceAll('-', '')}`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(`CREATE TYPE "OrderMode" AS ENUM ('DINE_IN', 'TAKEOUT');
    CREATE TABLE shops (id text PRIMARY KEY);
    CREATE TABLE orders (id text PRIMARY KEY, mode "OrderMode" NOT NULL, status text);
    INSERT INTO shops VALUES ('shop');
    INSERT INTO orders VALUES ('legacy-dine', 'DINE_IN', 'CONFIRMED'), ('legacy-takeout', 'TAKEOUT', 'CONFIRMED');`);
  const migration = await readFile(new URL('../prisma/migrations/20261025090000_dine_in_service_type/migration.sql', import.meta.url), 'utf8');
  await client.query(migration.replaceAll('public.', `"${schema}".`));
  const rows = (await client.query('SELECT id, "serviceType" FROM orders ORDER BY id')).rows;
  assert.deepEqual(rows, [{ id: 'legacy-dine', serviceType: 'TABLE_SERVICE' }, { id: 'legacy-takeout', serviceType: null }]);
  assert.equal((await client.query('SELECT "dineInServiceMode" FROM shops')).rows[0].dineInServiceMode, 'BOTH');
  await client.query(`INSERT INTO orders VALUES ('counter', 'DINE_IN', 'PENDING_CONFIRMATION', 'COUNTER_PICKUP');
    INSERT INTO orders VALUES ('table', 'DINE_IN', 'PENDING_CONFIRMATION', 'TABLE_SERVICE');
    INSERT INTO orders VALUES ('takeout', 'TAKEOUT', 'PENDING_CONFIRMATION', NULL);
    UPDATE orders SET status = 'CONFIRMED' WHERE id = 'counter';`);
  async function rejects(sql, code) {
    await client.query('SAVEPOINT rejected_write');
    await assert.rejects(client.query(sql), (error) => error.code === code);
    await client.query('ROLLBACK TO SAVEPOINT rejected_write');
  }
  await client.query(`INSERT INTO orders (id, mode, status) VALUES ('old-api', 'DINE_IN', 'PENDING_CONFIRMATION')`);
  assert.equal((await client.query(`SELECT "serviceType" FROM orders WHERE id = 'old-api'`)).rows[0].serviceType, 'TABLE_SERVICE');
  await rejects(`INSERT INTO orders VALUES ('invalid', 'TAKEOUT', 'PENDING_CONFIRMATION', 'COUNTER_PICKUP')`, '23514');
  await rejects(`UPDATE orders SET "serviceType" = 'TABLE_SERVICE' WHERE id = 'counter'`, '23514');
  await rejects(`UPDATE shops SET "dineInServiceMode" = 'DELIVERY'`, '22P02');
  await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rowCount, 0);
  console.log('Dine-in service migration: backfill, bindings, immutability and rollback passed.');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
