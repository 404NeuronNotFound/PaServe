import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Run the real migration in a disposable schema within one rollback-only transaction.
// Never change deployed tables or apply pending application migrations here.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const schema = `receipt_shop_${randomUUID().replaceAll('-', '')}`;
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`CREATE TABLE "${schema}".orders (id integer PRIMARY KEY, status text)`);
  await client.query(`INSERT INTO "${schema}".orders VALUES (1, 'PENDING_CONFIRMATION')`);
  const migration = await readFile(new URL('../prisma/migrations/20261016030000_receipt_shop_details/migration.sql', import.meta.url), 'utf8');
  await client.query(migration.replaceAll('public.', `"${schema}".`));
  const details = { name: 'Original Cafe', address: '12 Old Street', phone: '09171234567', contactEmail: null, website: null };
  await client.query(`INSERT INTO "${schema}".orders (id, status, "shopDetailsSnapshot") VALUES (2, 'PENDING_CONFIRMATION', $1)`, [details]);
  await client.query(`UPDATE "${schema}".orders SET status = 'CONFIRMED' WHERE id = 2`);
  const rows = (await client.query(`SELECT id, "shopDetailsSnapshot" FROM "${schema}".orders ORDER BY id`)).rows;
  assert.equal(rows[0].shopDetailsSnapshot, null);
  assert.deepEqual(rows[1].shopDetailsSnapshot, details);
  for (const [id, snapshot] of [[2, { ...details, name: 'Changed' }], [2, null], [1, details]]) {
    await client.query('SAVEPOINT immutable_check');
    await assert.rejects(
      client.query(`UPDATE "${schema}".orders SET "shopDetailsSnapshot" = $1 WHERE id = $2`, [snapshot, id]),
      (error) => error.code === '23514',
    );
    await client.query('ROLLBACK TO SAVEPOINT immutable_check');
  }
  await client.query('ROLLBACK');
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  assert.equal(remaining.rowCount, 0);
  console.log('Receipt shop details migration, legacy nulls, immutable snapshots and rollback cleanup passed.');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
