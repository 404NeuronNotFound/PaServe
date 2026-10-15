import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exact trigger on temporary tables. All messages/policies/grants roll back.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shop = randomUUID(),
  slug = `fixture-${randomUUID()}`;
const topic = `menu:availability:${shop}:${slug}`;
const count = async () =>
  Number(
    (
      await db.query(
        'SELECT count(*) n FROM realtime.messages WHERE topic=$1',
        [topic],
      )
    ).rows[0].n,
  );
try {
  await db.connect();
  await db.query('BEGIN');
  await db.query(`CREATE TEMP TABLE shops(id text PRIMARY KEY,slug text,"isActive" boolean);
    CREATE TEMP TABLE categories(id text PRIMARY KEY,"shopId" text,"isVisible" boolean);
    CREATE TEMP TABLE products(id text PRIMARY KEY,"shopId" text,"categoryId" text,status text,"isArchived" boolean);`);
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20261016000000_product_sold_out_events/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await db.query(
    migration
      .split('CREATE POLICY')[0]
      .replaceAll('public.products', 'pg_temp.products')
      .replaceAll('public.shops', 'pg_temp.shops')
      .replaceAll('public.categories', 'pg_temp.categories')
      .replaceAll(
        'public.broadcast_product_sold_out',
        'pg_temp.broadcast_product_sold_out',
      ),
  );
  const installed = await db.query(
    "SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='menu_availability_backend_only'",
  );
  if (!installed.rowCount)
    await db.query(migration.slice(migration.indexOf('CREATE POLICY')));
  await db.query('INSERT INTO pg_temp.shops VALUES($1,$2,true)', [shop, slug]);
  await db.query('INSERT INTO pg_temp.categories VALUES($1,$2,false)', [
    'hidden',
    shop,
  ]);
  const create = (
    id,
    category = null,
    status = 'AVAILABLE',
    archived = false,
  ) =>
    db.query('INSERT INTO pg_temp.products VALUES($1,$2,$3,$4,$5)', [
      id,
      shop,
      category,
      status,
      archived,
    ]);
  const sell = (id) =>
    db.query(`UPDATE pg_temp.products SET status='SOLD_OUT' WHERE id=$1`, [id]);
  await create('coffee');
  await db.query('SAVEPOINT sale');
  await sell('coffee');
  assert.equal(await count(), 1);
  await db.query('ROLLBACK TO SAVEPOINT sale');
  assert.equal(await count(), 0);
  await sell('coffee');
  await sell('coffee');
  for (const [id, category, status, archived] of [
    ['hidden-category', 'hidden', 'AVAILABLE', false],
    ['archived', null, 'AVAILABLE', true],
    ['hidden-product', null, 'HIDDEN', false],
  ]) {
    await create(id, category, status, archived);
    await sell(id);
  }
  await create('inactive');
  await db.query('UPDATE pg_temp.shops SET "isActive"=false');
  await sell('inactive');
  assert.equal(
    await count(),
    1,
    'Retries and nonpublic products/shops must not broadcast',
  );
  const row = (
    await db.query(
      'SELECT event,private,payload FROM realtime.messages WHERE topic=$1',
      [topic],
    )
  ).rows[0];
  assert.equal(row.event, 'product_sold_out');
  assert.equal(row.private, true);
  assert.equal(row.payload.shopSlug, slug);
  assert.deepEqual(Object.keys(row.payload).sort(), ['id', 'shopSlug']);
  for (const role of ['anon', 'authenticated']) {
    await db.query(`GRANT USAGE ON SCHEMA realtime TO ${role}`);
    await db.query(`GRANT SELECT,INSERT ON realtime.messages TO ${role}`);
    await db.query(
      `CREATE POLICY fixture_menu_${role} ON realtime.messages FOR ALL TO ${role} USING(true) WITH CHECK(true)`,
    );
    await db.query(`SET LOCAL ROLE ${role}`);
    assert.equal(await count(), 0);
    await db.query('RESET ROLE');
    await db.query('SAVEPOINT publish');
    await db.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(
      db.query(
        `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'product_sold_out','{}',true,'broadcast')`,
        [topic],
      ),
      (e) => e.code === '42501',
    );
    await db.query('ROLLBACK TO SAVEPOINT publish');
    await db.query('RESET ROLE');
  }
  await db.query('ROLLBACK');
  assert.equal(await count(), 0);
  console.log(
    'Passed: sold-out transition, retry/visibility/shop gating, rollback, minimal private invalidation, and anon/authenticated receive/publish denial. All fixtures rolled back.',
  );
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end();
}
