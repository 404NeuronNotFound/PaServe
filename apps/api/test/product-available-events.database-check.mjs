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
      '../prisma/migrations/20261016010000_product_available_events/migration.sql',
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
        'public.broadcast_product_available',
        'pg_temp.broadcast_product_available',
      ),
  );
  const installed = await db.query(
    "SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='menu_availability_backend_only'",
  );
  if (!installed.rowCount) {
    const prerequisite = await readFile(
      new URL(
        '../prisma/migrations/20261016000000_product_sold_out_events/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.query(prerequisite.slice(prerequisite.indexOf('CREATE POLICY')));
  }
  await db.query('INSERT INTO pg_temp.shops VALUES($1,$2,true)', [shop, slug]);
  await db.query('INSERT INTO pg_temp.categories VALUES($1,$2,false)', [
    'hidden',
    shop,
  ]);
  const create = (id, category = null, status = 'SOLD_OUT', archived = false) =>
    db.query('INSERT INTO pg_temp.products VALUES($1,$2,$3,$4,$5)', [
      id,
      shop,
      category,
      status,
      archived,
    ]);
  const restore = (id) =>
    db.query(`UPDATE pg_temp.products SET status='AVAILABLE' WHERE id=$1`, [
      id,
    ]);
  await create('hidden-restored', null, 'HIDDEN');
  await db.query('SAVEPOINT hidden_restoration');
  await restore('hidden-restored');
  assert.equal(
    await count(),
    1,
    'Authorized unhide restores the public menu too',
  );
  await db.query('ROLLBACK TO SAVEPOINT hidden_restoration');
  assert.equal(await count(), 0);
  await create('coffee');
  await db.query('SAVEPOINT sale');
  await restore('coffee');
  assert.equal(await count(), 1);
  await db.query('ROLLBACK TO SAVEPOINT sale');
  assert.equal(await count(), 0);
  await restore('coffee');
  await restore('coffee');
  for (const [id, category, status, archived] of [
    ['hidden-category', 'hidden', 'SOLD_OUT', false],
    ['archived', null, 'SOLD_OUT', true],
    ['already-available', null, 'AVAILABLE', false],
  ]) {
    await create(id, category, status, archived);
    await restore(id);
  }
  await create('inactive');
  await db.query('UPDATE pg_temp.shops SET "isActive"=false');
  await restore('inactive');
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
  assert.equal(row.event, 'product_available');
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
        `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'product_available','{}',true,'broadcast')`,
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
    'Passed: availability restoration, retry/visibility/shop gating, rollback, minimal private invalidation, and anon/authenticated receive/publish denial. All fixtures rolled back.',
  );
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end();
}
