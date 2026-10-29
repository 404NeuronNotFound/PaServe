// Isolated real PostgreSQL cache/invalidation checks; never a hosted target.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { BoundedPgAdapter } from '../dist/database/bounded-pg.adapter.js';
import { databasePoolPolicy } from '../dist/database/database-pool.policy.js';
import { databaseTimeouts } from '../dist/database/database-timeouts.js';
import { PublicMenuCache } from '../dist/modules/categories/public-menu-cache.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { PublicMenuController } from '../dist/modules/categories/public-menu.controller.js';
import { PublicTablesRepository } from '../dist/modules/tables/public-tables.repository.js';
import { TableContextService } from '../dist/modules/tables/table-context.service.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { PublicProductService } from '../dist/modules/products/public-product.service.js';
import { measureCaching } from './caching-latency.check.mjs';

assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  'Use test:caching:postgres; hosted targets refused.',
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const deadlines = databaseTimeouts({});
const prisma = new PrismaClient({
  adapter: new BoundedPgAdapter(
    { connectionString: process.env.DATABASE_URL, ...deadlines.pool },
    databasePoolPolicy({}),
  ),
  log: [{ emit: 'event', level: 'query' }],
  transactionOptions: deadlines.transactionOptions,
});
const events = [];
let capture = false;
prisma.$on('query', (event) => {
  if (capture) events.push(event);
});
const config = (overrides) =>
  new ConfigService({
    PUBLIC_MENU_CACHE_ENABLED: true,
    PUBLIC_MENU_CACHE_TTL_MS: 15000,
    PUBLIC_MENU_CACHE_MAX_ENTRIES: 128,
    PUBLIC_MENU_CACHE_MAX_BYTES: 8388608,
    PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES: 524288,
    PUBLIC_MENU_CACHE_MAX_IN_FLIGHT: 16,
    ...overrides,
  });
const caches = [new PublicMenuCache(config()), new PublicMenuCache(config())];
const contexts = new TableContextService(new ConfigService());
let proofs = 0;
const controller = (repo) =>
  new PublicMenuController(repo, new PublicTablesRepository(prisma), {
    issue(...args) {
      proofs++;
      return contexts.issue(...args);
    },
  });
const repos = caches.map((cache) => new PublicMenuRepository(prisma, cache));
const controls = repos.map(controller);
const res = {
  setHeader(name, value) {
    assert.equal(name, 'Cache-Control');
    assert.equal(value, 'no-store');
  },
};
const results = [],
  measurements = [];
const check = async (name, run) => {
  await run();
  results.push({ name, pass: true });
};
const read = (process = 0, slug = 'cache-a', query = {}) =>
  controls[process].read(slug, res, query);
const count = async (name, run) => {
  events.length = 0;
  capture = true;
  try {
    const value = await run();
    measurements.push({
      name,
      selects: events.filter((event) =>
        /^(SELECT|WITH)\b/i.test(event.query.trim()),
      ).length,
    });
    return value;
  } finally {
    capture = false;
    events.length = 0;
  }
};
const version = async (shop) =>
  (
    await prisma.menuCacheState.findUniqueOrThrow({
      where: { shopId: shop.id },
    })
  ).version;
await db.connect();
try {
  await db.query(`SET TIME ZONE 'UTC'; ALTER DATABASE postgres SET timezone='UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages(topic text,event text,payload jsonb,private boolean);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages(payload,event,topic,private) VALUES($1,$2,$3,$4) $$;`);
  for (const name of (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((name) => /^\d/.test(name))
    .sort())
    await db.query(
      await readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      ),
    );
  const shops = [];
  for (const [slug, price] of [
    ['cache-a', '10.00'],
    ['cache-b', '99.00'],
  ]) {
    const shop = await prisma.shop.create({ data: { name: slug, slug } });
    const category = await prisma.category.create({
      data: { shopId: shop.id, name: 'Drinks', slug: 'drinks' },
    });
    const products = Array.from({ length: 200 }, (_, i) => ({
      id: randomUUID(),
      shopId: shop.id,
      categoryId: category.id,
      name: `${slug} product ${i}`,
      slug: i === 0 ? 'coffee' : `product-${i}`,
      price,
      sortOrder: i,
    }));
    await prisma.product.createMany({ data: products });
    shops.push({ ...shop, category, product: products[0] });
  }
  const [a, b] = shops;
  let cold;
  await check(
    'warm public page skips catalog SQL, retains no-store and returns independent data',
    async () => {
      cold = await count('cold pickup page', () => read());
      const warm = await count('warm pickup page', () => read());
      assert.deepEqual(warm, cold);
      assert.equal(measurements.at(-2).selects, 5);
      assert.equal(measurements.at(-1).selects, 3);
      assert.equal(warm.products.length, 100);
      assert.equal(warm.products[0].price, '10.00');
      warm.products[0].name = 'Caller mutation';
      assert.notEqual((await read()).products[0].name, 'Caller mutation');
      const payload = JSON.stringify(await read());
      assert.ok(!payload.includes(await version(a)));
      assert.ok(!payload.includes('checkoutToken'));
    },
  );
  await check('tenant and pagination keys cannot mix collections', async () => {
    const other = await read(0, b.slug);
    assert.equal(other.products[0].price, '99.00');
    assert.ok(
      other.products.every((product) => product.name.startsWith(b.slug)),
    );
    const first = await read(0, a.slug, { limit: '1' });
    assert.equal(first.products.length, 1);
    const next = await read(0, a.slug, {
      limit: '1',
      productsCursor: first.nextProductsCursor,
      categoriesCursor: 'end',
    });
    assert.equal(next.products.length, 1);
    assert.notEqual(next.products[0].id, first.products[0].id);
    assert.deepEqual(next.categories, []);
    await assert.rejects(
      read(0, b.slug, { productsCursor: first.nextProductsCursor }),
      { status: 400 },
    );
  });
  await check(
    'committed writes invalidate both API cache instances without flushing another shop',
    async () => {
      await read(1);
      const otherVersion = await version(b);
      await prisma.product.update({
        where: { id: a.product.id },
        data: { price: '12.34', name: 'Updated A' },
      });
      for (const process of [0, 1]) {
        const page = await read(process);
        assert.equal(page.products[0].price, '12.34');
        assert.equal(page.products[0].name, 'Updated A');
      }
      const hits = caches[0].snapshot().hits;
      await read(0, b.slug);
      assert.equal(caches[0].snapshot().hits, hits + 1);
      assert.equal(await version(b), otherVersion);
    },
  );
  await check(
    'visibility, stock, image and category changes invalidate public display',
    async () => {
      await prisma.category.update({
        where: { id: a.category.id },
        data: { isVisible: false },
      });
      for (const process of [0, 1]) {
        const page = await read(process);
        assert.deepEqual(page.products, []);
        assert.deepEqual(page.categories, []);
      }
      await prisma.category.update({
        where: { id: a.category.id },
        data: { isVisible: true, name: 'Renamed drinks' },
      });
      await prisma.product.update({
        where: { id: a.product.id },
        data: {
          status: 'SOLD_OUT',
          imageUrl: 'https://example.invalid/new.webp',
        },
      });
      const changed = await read();
      assert.equal(changed.categories[0].name, 'Renamed drinks');
      assert.equal(changed.products[0].isOrderable, false);
      assert.equal(
        changed.products[0].imageUrl,
        'https://example.invalid/new.webp',
      );
      await prisma.product.update({
        where: { id: a.product.id },
        data: { isArchived: true },
      });
      assert.ok(
        (await read()).products.every((product) => product.id !== a.product.id),
      );
      await prisma.product.update({
        where: { id: a.product.id },
        data: { isArchived: false, status: 'AVAILABLE' },
      });
    },
  );
  await check(
    'raw SQL changes invalidate while rolled-back transactions retain a valid entry',
    async () => {
      await read();
      const prior = await version(a);
      const rollback = new Error('intentional rollback');
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: a.product.id },
            data: { price: '88.88' },
          });
          throw rollback;
        }),
        (error) => error === rollback,
      );
      assert.equal(await version(a), prior);
      assert.equal((await read()).products[0].price, '12.34');
      await db.query(
        'UPDATE products SET price=22.22 WHERE id=$1 AND "shopId"=$2',
        [a.product.id, a.id],
      );
      assert.notEqual(await version(a), prior);
      for (const process of [0, 1])
        assert.equal((await read(process)).products[0].price, '22.22');
    },
  );
  await check(
    'insert, reorder and delete advance the catalog version',
    async () => {
      const product = await prisma.product.create({
        data: {
          shopId: a.id,
          categoryId: a.category.id,
          name: 'New first',
          slug: 'new-first',
          price: '1.00',
          sortOrder: 0,
          createdAt: new Date('2026-01-01'),
        },
      });
      assert.equal((await read()).products[0].id, product.id);
      await prisma.product.update({
        where: { id: product.id },
        data: { sortOrder: 999 },
      });
      assert.notEqual((await read()).products[0].id, product.id);
      const before = await version(a);
      await prisma.product.delete({ where: { id: product.id } });
      assert.notEqual(await version(a), before);
    },
  );
  await check(
    'branding and active-shop gates stay live even with warm catalog pages',
    async () => {
      await read();
      await prisma.shop.update({
        where: { id: a.id },
        data: { name: 'Fresh branding' },
      });
      assert.equal((await read()).shop.name, 'Fresh branding');
      await prisma.shop.update({
        where: { id: a.id },
        data: { isActive: false },
      });
      await assert.rejects(read(), { status: 404 });
      await prisma.shop.update({
        where: { id: a.id },
        data: { isActive: true },
      });
      assert.equal((await read()).shop.name, 'Fresh branding');
    },
  );
  await check(
    'table menus bypass cache and issue live checkout proof; table revocation wins',
    async () => {
      const table = await prisma.restaurantTable.create({
        data: { shopId: a.id, number: '1', code: 'T12' },
      });
      const before = caches[0].snapshot();
      const first = await controls[0].readTable(a.slug, 'T12', res);
      await controls[0].readTable(a.slug, 'T12', res);
      contexts.verify(first.table.checkoutToken, a.slug, 'T12');
      assert.equal(proofs, 2);
      assert.deepEqual(caches[0].snapshot(), before);
      await prisma.restaurantTable.update({
        where: { id: table.id },
        data: { isActive: false },
      });
      await assert.rejects(controls[0].readTable(a.slug, 'T12', res), {
        status: 404,
      });
    },
  );
  await check(
    'quotes bypass display cache and re-read authoritative prices',
    async () => {
      await read();
      const pricing = new PublicProductService(
        new PublicProductRepository(prisma),
      );
      const selection = { quantity: 1, variantIds: [], addOnIds: [] };
      const stats = caches[0].snapshot();
      await count('first live quote', () =>
        pricing.quote(a.slug, a.product.id, selection),
      );
      await prisma.product.update({
        where: { id: a.product.id },
        data: { price: '33.33' },
      });
      const quote = await count('next live quote', () =>
        pricing.quote(a.slug, a.product.id, selection),
      );
      assert.equal(quote.totalPrice, '33.33');
      assert.deepEqual(caches[0].snapshot(), stats);
      assert.equal(measurements.at(-2).selects, measurements.at(-1).selects);
    },
  );
  await check(
    'concurrent misses coalesce catalog SQL instead of loading once per caller',
    async () => {
      caches[0].clear();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const controlled = new PublicMenuRepository(
        {
          shop: prisma.shop,
          menuCacheState: prisma.menuCacheState,
          product: prisma.product,
          category: {
            findMany: async (args) => {
              await gate;
              return prisma.category.findMany(args);
            },
          },
        },
        caches[0],
      );
      const before = caches[0].snapshot();
      const jobs = Array.from({ length: 8 }, () => controlled.read(a.slug));
      try {
        const until = Date.now() + 3000;
        while (caches[0].snapshot().coalesced < before.coalesced + 7) {
          assert.ok(Date.now() < until, 'Followers did not coalesce');
          await delay(5);
        }
      } finally {
        release();
      }
      const pages = await Promise.all(jobs);
      for (const page of pages) assert.deepEqual(page, pages[0]);
      assert.equal(caches[0].snapshot().misses, before.misses + 1);
    },
  );
  await check(
    'late old-version loads cannot republish stale data for new-version requests',
    async () => {
      caches[0].clear();
      let release, captured;
      const gate = new Promise((resolve) => {
          release = resolve;
        }),
        ready = new Promise((resolve) => {
          captured = resolve;
        });
      const controlled = new PublicMenuRepository(
        {
          shop: prisma.shop,
          menuCacheState: prisma.menuCacheState,
          category: {
            findMany: async (args) => {
              await gate;
              return prisma.category.findMany(args);
            },
          },
          product: {
            findMany: async (args) => {
              const value = await prisma.product.findMany(args);
              captured();
              return value;
            },
          },
        },
        caches[0],
      );
      const old = controlled.read(a.slug);
      await ready;
      try {
        await prisma.product.update({
          where: { id: a.product.id },
          data: { price: '44.44' },
        });
      } finally {
        release();
      }
      await old;
      assert.equal((await read()).products[0].price, '44.44');
      assert.equal((await read(1)).products[0].price, '44.44');
    },
  );
  await check(
    'disabled or missing cache state falls back to live bounded reads',
    async () => {
      const disabled = new PublicMenuCache(
        config({ PUBLIC_MENU_CACHE_ENABLED: false }),
      );
      const uncached = controller(new PublicMenuRepository(prisma, disabled));
      await count('disabled cache page', () => uncached.read(a.slug, res));
      assert.equal(measurements.at(-1).selects, 4);
      assert.equal(disabled.snapshot().entries, 0);
      await prisma.menuCacheState.delete({ where: { shopId: a.id } });
      assert.equal((await read()).products[0].price, '44.44');
      await prisma.product.update({
        where: { id: a.product.id },
        data: { price: '45.45' },
      });
      assert.equal((await read()).products[0].price, '45.45');
    },
  );
  await check(
    'database failures are not hidden by previously cached public data',
    async () => {
      await read();
      const repo = new PublicMenuRepository(
        {
          shop: {
            findFirst: async () => {
              throw new Error('fixture database outage');
            },
          },
        },
        caches[0],
      );
      const hits = caches[0].snapshot().hits;
      await assert.rejects(repo.read(a.slug), /fixture database outage/);
      assert.equal(caches[0].snapshot().hits, hits);
    },
  );
  await check(
    'missing menus are not negatively cached and deleted/recreated shops use a new epoch',
    async () => {
      await assert.rejects(read(0, 'future-menu'), { status: 404 });
      const shop = await prisma.shop.create({
        data: { name: 'Future menu', slug: 'future-menu' },
      });
      const oldVersion = await version(shop);
      await prisma.product.create({
        data: {
          shopId: shop.id,
          name: 'Old product',
          slug: 'coffee',
          price: '1.00',
        },
      });
      assert.equal((await read(0, shop.slug)).products[0].name, 'Old product');
      await prisma.shop.delete({ where: { id: shop.id } });
      await assert.rejects(read(0, shop.slug), { status: 404 });
      await prisma.shop.create({
        data: { id: shop.id, name: 'New shop', slug: shop.slug },
      });
      assert.notEqual(await version(shop), oldVersion);
      await prisma.product.create({
        data: {
          shopId: shop.id,
          name: 'New product',
          slug: 'coffee',
          price: '2.00',
        },
      });
      assert.equal((await read(0, shop.slug)).products[0].name, 'New product');
    },
  );
  let invalidationWrite;
  await check(
    'multi-row catalog writes run one invalidation trigger per statement',
    async () => {
      const plan = (
        await db.query(
          'EXPLAIN (ANALYZE, FORMAT JSON) UPDATE products SET "sortOrder"="sortOrder"+1 WHERE "shopId"=$1',
          [a.id],
        )
      ).rows[0]['QUERY PLAN'][0];
      const trigger = plan.Triggers.find(
        (trigger) => trigger['Trigger Name'] === 'products_menu_cache_update',
      );
      assert.ok(trigger);
      assert.equal(trigger.Calls, 1);
      invalidationWrite = {
        products: 200,
        triggerCalls: trigger.Calls,
        triggerMs: trigger.Time,
        totalMs: plan['Execution Time'],
      };
    },
  );
  await check(
    'browser database roles cannot read or mutate internal invalidation state',
    async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.query(`SET ROLE ${role}`);
        try {
          await assert.rejects(
            db.query('SELECT * FROM public.menu_cache_versions'),
            (error) => error.code === '42501',
          );
          await assert.rejects(
            db.query('DELETE FROM public.menu_cache_versions'),
            (error) => error.code === '42501',
          );
        } finally {
          await db.query('RESET ROLE');
        }
      }
    },
  );
  const benchmark = await measureCaching({
    prisma,
    shops,
    config,
    controller,
  });
  results.push({
    name: 'repeat-menu HTTP hit rate and latency measured against disabled cache',
    pass: true,
  });
  const report = {
    pass: true,
    environment: 'disposable PostgreSQL; no hosted provider',
    checks: results,
    measurements,
    invalidationWrite,
    benchmark,
    cacheSnapshots: caches.map((cache) => cache.snapshot()),
    limits:
      'Public pickup catalog pages only. DB gates are never cached; no stale-on-error. Separate cache objects simulate process-local stores sharing committed DB versions. Production hit rates, memory and write throughput need deployment validation.',
  };
  await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
  await writeFile(
    process.env.TIMEOUT_DB_REPORT,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      { pass: true, checks: results, measurements, invalidationWrite },
      null,
      2,
    ),
  );
} finally {
  caches.forEach((cache) => cache.onModuleDestroy());
  await prisma.$disconnect();
  await db.end();
}
