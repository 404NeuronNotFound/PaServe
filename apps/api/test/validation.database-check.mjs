import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  SHOP_LIMITS,
  CATEGORY_LIMITS,
  PRODUCT_LIMITS,
} from '@paserve/contracts';

// Production rows are read only as aggregate preflight counts. DDL and writes
// target session-local temporary copies and always roll back.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '20s'");
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261019000000_validation_hardening/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const checks = [
    ...migration.matchAll(
      /ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)"\s+CHECK \(([\s\S]*?)\);/g,
    ),
  ];
  assert.equal(checks.length, 7);
  for (const [, table, constraint, expression] of checks) {
    const { rows } = await client.query(
      `SELECT count(*)::text AS invalid FROM public."${table}" WHERE NOT (${expression})`,
    );
    assert.equal(
      rows[0].invalid,
      '0',
      `Existing data violates ${constraint}; review before deployment.`,
    );
  }
  for (const table of ['shops', 'categories', 'products']) {
    await client.query(
      `CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL) ON COMMIT DROP`,
    );
  }
  await client.query('SET LOCAL search_path = pg_temp, public');
  // Rerunnable after deployment: remove only the copied constraints in pg_temp.
  for (const [, table, constraint] of checks) {
    await client.query(`ALTER TABLE pg_temp."${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
  }
  await client.query(migration.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
  const shopId = randomUUID(),
    categoryId = randomUUID(),
    productId = randomUUID();
  await client.query(
    'INSERT INTO pg_temp.shops (id, name, slug, "updatedAt") VALUES ($1, $2, $3, now())',
    [shopId, 'Validation fixture', randomUUID()],
  );
  await client.query(
    'INSERT INTO pg_temp.categories (id, "shopId", name, slug, "updatedAt") VALUES ($1, $2, $3, $4, now())',
    [categoryId, shopId, 'Coffee', randomUUID()],
  );
  await client.query(
    'INSERT INTO pg_temp.products (id, "shopId", name, slug, price, "updatedAt") VALUES ($1, $2, $3, $4, 1.00, now())',
    [productId, shopId, 'Coffee', randomUUID()],
  );
  const limits = {
    shops: SHOP_LIMITS,
    categories: CATEGORY_LIMITS,
    products: PRODUCT_LIMITS,
  };
  const ids = { shops: shopId, categories: categoryId, products: productId };
  let rejected = 0;
  const reject = async (sql, values, constraint) => {
    await client.query('SAVEPOINT invalid_input');
    await assert.rejects(
      client.query(sql, values),
      (error) =>
        error.code === '23514' &&
        (!constraint || error.constraint === constraint),
    );
    await client.query('ROLLBACK TO SAVEPOINT invalid_input');
    rejected++;
  };
  for (const table of Object.keys(limits)) {
    const { nameMax, descriptionMax } = limits[table];
    const sql = `UPDATE pg_temp."${table}" SET name = $1 WHERE id = $2`;
    await client.query(sql, ['\u{1f600}'.repeat(nameMax), ids[table]]);
    for (const name of ['', '   ', 'a'.repeat(nameMax + 1), ' ' + 'a'.repeat(nameMax)])
      await reject(sql, [name, ids[table]], `${table}_name_length_check`);
    await client.query(
      `UPDATE pg_temp."${table}" SET description = $1 WHERE id = $2`,
      ['a'.repeat(descriptionMax), ids[table]],
    );
    await reject(
      `UPDATE pg_temp."${table}" SET description = $1 WHERE id = $2`,
      ['a'.repeat(descriptionMax + 1), ids[table]],
      `${table}_description_length_check`,
    );
  }
  for (const column of ['sortOrder', 'featuredSortOrder'])
    await reject(
      `UPDATE pg_temp.products SET "${column}" = -1 WHERE id = $1`,
      [productId],
      'products_sort_order_nonnegative',
    );
  for (const price of ['-0.01', 'NaN'])
    await reject(
      'UPDATE pg_temp.products SET price = $1::numeric WHERE id = $2',
      [price, productId],
    );
  console.log(
    `Validation database checks passed: 7 legacy-data preflights, Unicode/length boundaries, ${rejected} rejected writes. Temporary schema and fixtures rolled back.`,
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Database verification failed (${error.code ?? error.name}); no credentials or row data logged.`,
  );
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
