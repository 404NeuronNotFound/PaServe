// Actual repositories/Prisma SQL on a disposable cluster; no hosted target.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { BoundedPgAdapter } from '../dist/database/bounded-pg.adapter.js';
import { databasePoolPolicy } from '../dist/database/database-pool.policy.js';
import { databaseTimeouts } from '../dist/database/database-timeouts.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { ActiveOrdersService } from '../dist/modules/orders/active-orders.service.js';
import { CancelledOrdersService } from '../dist/modules/orders/cancelled-orders.service.js';
import { ProductsRepository } from '../dist/modules/products/products.repository.js';
import { CategoriesRepository } from '../dist/modules/categories/categories.repository.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { readHistoryPage } from '../dist/modules/orders/history-pagination.js';

assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  'Use test:tenant-performance:postgres; hosted targets are refused.',
);
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
const deadlines = databaseTimeouts({});
const adapter = new BoundedPgAdapter(
  { connectionString: process.env.DATABASE_URL, ...deadlines.pool },
  databasePoolPolicy({}),
);
const prisma = new PrismaClient({
  adapter,
  transactionOptions: deadlines.transactionOptions,
  log: [{ emit: 'event', level: 'query' }],
});
const events = [];
let captureQueries = true;
prisma.$on('query', (event) => {
  if (captureQueries) events.push(event);
});
const members = new ShopMembersService(new ShopMembersRepository(prisma));
const active = new ActiveOrdersService(prisma, members),
  cancelled = new CancelledOrdersService(prisma, members);
const products = new ProductsRepository(prisma),
  categories = new CategoriesRepository(prisma);
const resources = new TenantResourcesRepository(prisma),
  menu = new PublicMenuRepository(prisma),
  publicProduct = new PublicProductRepository(prisma);
const actor = randomUUID(),
  outsider = randomUUID();
const tenants = ['small', 'large', 'empty'].map((name) => ({
  id: randomUUID(),
  name,
  slug: `tenant-performance-${name}`,
}));
const [small, large, empty] = tenants;
const checks = [];
const check = async (name, run) => {
  await run();
  checks.push({ name, pass: true });
};
await setup.connect();
try {
  // Portable PostgreSQL inherits the workstation zone. Prisma's timestamp
  // mapping expects UTC; use UTC for setup and every subsequent fixture client.
  await setup.query(
    "SET TIME ZONE 'UTC'; ALTER DATABASE postgres SET timezone TO 'UTC';",
  );
  await setup.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages(topic text,event text,payload jsonb,private boolean);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS
    $$ INSERT INTO realtime.messages(payload,event,topic,private) VALUES($1,$2,$3,$4) $$;`);
  for (const name of (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((n) => /^\d/.test(n))
    .sort())
    await setup.query(
      await readFile(
        new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      ),
    );
  for (const [id, label] of [
    [actor, 'shared-owner'],
    [outsider, 'large-only-owner'],
  ])
    await prisma.user.create({
      data: {
        id,
        email: `${label}@tenant-performance.example.invalid`,
        passwordHash: 'fixture-no-login',
      },
    });
  for (const tenant of tenants) {
    await prisma.shop.create({
      data: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    });
    await prisma.shopMember.create({
      data: { userId: actor, shopId: tenant.id, role: 'OWNER' },
    });
    tenant.category = await prisma.category.create({
      data: { shopId: tenant.id, name: 'Same category', slug: 'same-category' },
    });
  }
  await prisma.shopMember.create({
    data: { userId: outsider, shopId: large.id, role: 'OWNER' },
  });
  const seed = async (tenant, from, to, productCount) => {
    await setup.query(
      `INSERT INTO orders (id,"shopId","requestId","requestHash",mode,status,"totalPrice",items,"orderNumber",
      "qrTokenNonce","qrTokenExpiresAt","createdAt","decidedAt","decidedBy","qrTokenRevokedAt")
      SELECT gen_random_uuid()::text,$1,gen_random_uuid()::text,repeat('a',64),'TAKEOUT',
        CASE WHEN n%10=0 THEN 'PENDING_CONFIRMATION' ELSE 'REJECTED' END,
        10,'[{}]'::jsonb,'ORD-'||lpad(n::text,6,'0'),gen_random_uuid()::text,now()+interval '1 day',
        timestamp '2026-01-01'+n*interval '1 second',
        CASE WHEN n%10<>0 THEN now() END,CASE WHEN n%10<>0 THEN $2 END,CASE WHEN n%10<>0 THEN now() END
      FROM generate_series($3::int,$4::int) n`,
      [tenant.id, actor, from, to],
    );
    if (productCount)
      await setup.query(
        `INSERT INTO products (id,"shopId","categoryId",name,slug,price,"sortOrder","updatedAt")
      SELECT gen_random_uuid()::text,$1,$2,'Product '||n,'product-'||n,10,n,now() FROM generate_series($3::int,$4::int) n`,
        [tenant.id, tenant.category.id, from, from + productCount - 1],
      );
  };
  await seed(small, 1, 300, 20);
  await seed(large, 1, 1000, 100);
  small.product = await prisma.product.findFirst({
    where: { shopId: small.id, slug: 'product-1' },
  });
  large.product = await prisma.product.findFirst({
    where: { shopId: large.id, slug: 'product-1' },
  });
  const analyze = () =>
    setup.query(
      'ANALYZE orders; ANALYZE products; ANALYZE categories; ANALYZE shops; ANALYZE shop_members; ANALYZE users;',
    );
  await analyze();
  const historySnapshot = new Date().toISOString();
  const operations = [
    ['active first page', () => active.list(actor, small.id)],
    ['rejected first page', () => cancelled.list(actor, small.id)],
    [
      'rejected numbered page and count',
      () =>
        cancelled.list(actor, small.id, undefined, undefined, undefined, {
          page: '2',
          snapshot: historySnapshot,
        }),
    ],
    ['product list', () => products.list(actor, small.id)],
    ['category list', () => categories.list(actor, small.id)],
    ['public menu', () => menu.read(small.slug)],
    [
      'public product and relations',
      () => publicProduct.read(small.slug, small.product.id),
    ],
    [
      'resource lookup',
      () =>
        resources.findResource(actor, small.id, 'product', small.product.id),
    ],
  ];
  const probe = async () => {
    const measured = [];
    for (const [name, run] of operations) {
      events.length = 0;
      const started = performance.now();
      const result = await run();
      const elapsedMs = performance.now() - started;
      const captured = events.filter((event) =>
        /^SELECT\b/i.test(event.query.trim()),
      );
      assert.ok(
        captured.length > 0,
        `${String(name)}: expected captured Prisma SQL`,
      );
      const plans = [];
      for (const event of captured) {
        const values = JSON.parse(event.params);
        const explained = (
          await setup.query(
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + event.query,
            values,
          )
        ).rows[0]['QUERY PLAN'][0];
        const nodes = [];
        const walk = (node) => {
          nodes.push({
            type: node['Node Type'],
            relation: node['Relation Name'],
            index: node['Index Name'],
            rows: node['Actual Rows'],
            loops: node['Actual Loops'],
            removed: node['Rows Removed by Filter'] ?? 0,
          });
          (node.Plans ?? []).forEach(walk);
        };
        walk(explained.Plan);
        plans.push({
          sql: event.query,
          params: values,
          executionMs: explained['Execution Time'],
          buffers:
            (explained.Plan['Shared Hit Blocks'] ?? 0) +
            (explained.Plan['Shared Read Blocks'] ?? 0),
          nodes,
        });
      }
      measured.push({
        name,
        result,
        elapsedMs,
        queryCount: captured.length,
        plans,
      });
    }
    return measured;
  };
  const before = await probe();
  await seed(large, 1001, 100000, 19900);
  await analyze();
  const after = await probe();
  await check(
    'small-shop responses and query counts stay unchanged when another shop grows',
    async () => {
      for (let i = 0; i < after.length; i++) {
        assert.deepEqual(after[i].result, before[i].result, after[i].name);
        assert.equal(after[i].queryCount, before[i].queryCount, after[i].name);
      }
    },
  );
  await check(
    'actual Prisma plans avoid scanning the large shop for small-shop orders/products',
    async () => {
      for (const operation of after)
        for (const plan of operation.plans)
          for (const node of plan.nodes) {
            if (['orders', 'products'].includes(node.relation)) {
              assert.notEqual(
                node.type,
                'Seq Scan',
                `${String(operation.name)}: unexpected whole-table scan`,
              );
              assert.ok(
                (node.rows + node.removed) * node.loops <= 1000,
                `${String(operation.name)}: examined too many tenant rows`,
              );
            }
          }
    },
  );
  await check('numbered history counts only the selected shop', async () => {
    const page = after.find(
      (op) => op.name === 'rejected numbered page and count',
    ).result;
    assert.equal(page.pagination.total, 270);
    assert.equal(page.orders.length, 12);
    assert.ok(page.orders.every((order) => order.shopId === small.id));
  });
  await check(
    'overlapping product slugs resolve independently for each public shop',
    async () => {
      assert.equal(
        (await publicProduct.read(small.slug, small.product.id)).id,
        small.product.id,
      );
      assert.equal(
        (await publicProduct.read(large.slug, large.product.id)).id,
        large.product.id,
      );
      assert.equal(
        await publicProduct.read(small.slug, large.product.id),
        null,
      );
    },
  );
  await check(
    'membership in both shops does not allow mixing resource IDs',
    async () => {
      assert.equal(
        await resources.findResource(
          actor,
          small.id,
          'product',
          large.product.id,
        ),
        null,
      );
      assert.equal(
        await resources.findResource(
          actor,
          small.id,
          'category',
          large.category.id,
        ),
        null,
      );
      await assert.rejects(
        products.setArchived(actor, small.id, large.product.id, true, false),
        { code: 'P2025' },
      );
      assert.equal(
        (
          await prisma.product.findFirst({
            where: { id: large.product.id, shopId: large.id },
          })
        ).isArchived,
        false,
      );
    },
  );
  await check(
    'composite tenant FK rejects cross-shop category assignment',
    async () => {
      await assert.rejects(
        prisma.product.update({
          where: { id: small.product.id },
          data: { categoryId: large.category.id },
        }),
        { code: 'P2003' },
      );
    },
  );
  await check(
    'foreign memberships and invalid tenant contexts fail closed',
    async () => {
      await assert.rejects(active.list(outsider, small.id), { status: 404 });
      await assert.rejects(async () => products.list(actor, undefined), {
        status: 400,
      });
      await assert.rejects(
        readHistoryPage(
          prisma,
          { page: 1, snapshot: new Date() },
          {},
          {},
          () => {
            throw new Error('must not read');
          },
        ),
        { status: 400 },
      );
    },
  );
  await check('empty tenant returns empty history and zero count', async () => {
    const page = await cancelled.list(
      actor,
      empty.id,
      undefined,
      undefined,
      undefined,
      { page: '1' },
    );
    assert.deepEqual(page.orders, []);
    assert.equal(page.pagination.total, 0);
  });
  // Fixed local regression budgets, declared before running the workload.
  // They apply to repository/service latency, not production HTTP SLOs.
  const latencyBudget = { p95Ms: 250, p99Ms: 500, additionalP95Ms: 150 };
  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * fraction) - 1];
  };
  const smallCases = operations.slice(0, 3);
  const samples = { baseline: [], mixed: [] };
  let activeSmall = 0,
    activeLarge = 0,
    peakLarge = 0,
    overlappingSmallRequests = 0;
  let overlapBackendPeak = 0,
    monitoring = false;
  const largeRuns = [];
  const smallWorker = async (mode, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const [name, run] = smallCases[i % smallCases.length];
      const started = performance.now();
      activeSmall++;
      if (activeLarge > 0) overlappingSmallRequests++;
      try {
        const result = await run();
        assert.deepEqual(result, after.find((op) => op.name === name).result);
        samples[mode].push({ name, elapsedMs: performance.now() - started });
      } finally {
        activeSmall--;
      }
    }
  };
  captureQueries = false;
  events.length = 0;
  // Warm both tenants before comparison; record baselines on both sides of load.
  for (const [, run] of smallCases) await run();
  const largeHistory = () =>
    cancelled.list(actor, large.id, undefined, undefined, undefined, {
      page: '7500',
    });
  const warmLarge = await largeHistory();
  assert.equal(warmLarge.pagination.total, 90000);
  const settle = async (jobs) => {
    const outcomes = await Promise.allSettled(jobs);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure) throw failure.reason;
  };
  await settle([smallWorker('baseline', 30), smallWorker('baseline', 30)]);
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let smallDone = false;
  const largeWorker = async () => {
    await startGate;
    let completed = 0;
    while (!smallDone || completed < 20) {
      activeLarge++;
      peakLarge = Math.max(peakLarge, activeLarge);
      const started = performance.now();
      try {
        const page = await largeHistory();
        assert.equal(page.pagination.total, 90000);
        assert.equal(page.orders.length, 12);
        assert.ok(page.orders.every((order) => order.shopId === large.id));
        largeRuns.push(performance.now() - started);
        completed++;
      } finally {
        activeLarge--;
      }
    }
  };
  // Separate monitor connection proves simultaneous work on PostgreSQL, in
  // addition to overlapping JavaScript promises on the shared bounded pool.
  const monitor = async () => {
    while (monitoring) {
      const row = (
        await setup.query(`SELECT count(*)::int AS active FROM pg_stat_activity
        WHERE application_name='paserve-api' AND state='active' AND query ILIKE '%orders%'`)
      ).rows[0];
      if (activeSmall > 0 && activeLarge > 0)
        overlapBackendPeak = Math.max(overlapBackendPeak, row.active);
      await delay(10);
    }
  };
  monitoring = true;
  const monitorWork = monitor();
  const largeJobs = [largeWorker(), largeWorker()];
  const smallJobs = (async () => {
    await startGate;
    try {
      await settle([smallWorker('mixed', 60), smallWorker('mixed', 60)]);
    } finally {
      smallDone = true;
    }
  })();
  releaseStart();
  try {
    await settle([smallJobs, ...largeJobs]);
  } finally {
    monitoring = false;
    await monitorWork;
  }
  await settle([smallWorker('baseline', 30), smallWorker('baseline', 30)]);
  const comparisons = smallCases.map(([name]) => {
    const summarize = (mode) => {
      const elapsed = samples[mode]
        .filter((sample) => sample.name === name)
        .map((sample) => sample.elapsedMs);
      return {
        samples: elapsed.length,
        p50Ms: percentile(elapsed, 0.5),
        p95Ms: percentile(elapsed, 0.95),
        p99Ms: percentile(elapsed, 0.99),
        maxMs: Math.max(...elapsed),
      };
    };
    return { name, baseline: summarize('baseline'), mixed: summarize('mixed') };
  });
  await check(
    'large and small tenant histories execute concurrently on shared database workers',
    async () => {
      assert.equal(samples.mixed.length, 120);
      assert.ok(largeRuns.length >= 40);
      assert.equal(peakLarge, 2);
      assert.ok(overlappingSmallRequests >= 120);
      assert.ok(
        overlapBackendPeak >= 2,
        'Expected simultaneously active order statements in PostgreSQL',
      );
    },
  );
  await check(
    'small-shop tail latency stays within declared local mixed-load budgets',
    async () => {
      for (const comparison of comparisons) {
        assert.equal(comparison.baseline.samples, 40);
        assert.equal(comparison.mixed.samples, 40);
        assert.ok(
          comparison.mixed.p95Ms <= latencyBudget.p95Ms,
          `${String(comparison.name)}: mixed p95 budget exceeded`,
        );
        assert.ok(
          comparison.mixed.p99Ms <= latencyBudget.p99Ms,
          `${String(comparison.name)}: mixed p99 budget exceeded`,
        );
        assert.ok(
          comparison.mixed.p95Ms - comparison.baseline.p95Ms <=
            latencyBudget.additionalP95Ms,
          `${String(comparison.name)}: excessive p95 increase`,
        );
      }
    },
  );
  let concurrentOwnReads = 0,
    concurrentOwnWrites = 0,
    concurrentDenials = 0;
  await check(
    'tenant reads and writes remain isolated during simultaneous cross-shop attempts',
    async () => {
      await settle(
        Array.from({ length: 4 }, (_, worker) =>
          (async () => {
            for (let iteration = 0; iteration < 25; iteration++) {
              const own = (worker + iteration) % 2 === 0 ? small : large;
              const foreign = own === small ? large : small;
              await settle([
                (async () => {
                  const row = await resources.findResource(
                    actor,
                    own.id,
                    'product',
                    own.product.id,
                  );
                  assert.equal(row.shopId, own.id);
                  concurrentOwnReads++;
                })(),
                (async () => {
                  assert.equal(
                    await resources.findResource(
                      actor,
                      own.id,
                      'product',
                      foreign.product.id,
                    ),
                    null,
                  );
                  concurrentDenials++;
                })(),
                (async () => {
                  const row = await products.setArchived(
                    actor,
                    own.id,
                    own.product.id,
                    false,
                    false,
                  );
                  assert.equal(row.shopId, own.id);
                  concurrentOwnWrites++;
                })(),
                (async () => {
                  await assert.rejects(
                    products.setArchived(
                      actor,
                      own.id,
                      foreign.product.id,
                      true,
                      false,
                    ),
                    { code: 'P2025' },
                  );
                  concurrentDenials++;
                })(),
              ]);
            }
          })(),
        ),
      );
      assert.equal(concurrentOwnReads, 100);
      assert.equal(concurrentOwnWrites, 100);
      assert.equal(concurrentDenials, 200);
      for (const tenant of [small, large])
        assert.equal(
          (
            await prisma.product.findFirst({
              where: { id: tenant.product.id, shopId: tenant.id },
            })
          ).isArchived,
          false,
        );
    },
  );
  const concurrency = {
    pass: true,
    sharedPoolMax: 5,
    smallWorkers: 2,
    largeWorkers: 2,
    latencyBudget,
    comparisons,
    smallMixedRequests: samples.mixed.length,
    largeHistoryRequests: largeRuns.length,
    overlappingSmallRequests,
    simultaneousActiveOrderStatements: overlapBackendPeak,
    largeP95Ms: percentile(largeRuns, 0.95),
    isolation: {
      workers: 4,
      roundsPerWorker: 25,
      ownReads: concurrentOwnReads,
      ownWrites: concurrentOwnWrites,
      crossShopDenials: concurrentDenials,
    },
    rawSamples: samples,
  };
  await check('live membership removal stops subsequent reads', async () => {
    await prisma.shopMember.delete({
      where: { userId_shopId: { userId: actor, shopId: small.id } },
    });
    assert.equal(await products.list(actor, small.id), null);
    assert.equal(
      await resources.findResource(
        actor,
        small.id,
        'product',
        small.product.id,
      ),
      null,
    );
    await assert.rejects(active.list(actor, small.id), { status: 404 });
  });
  const compact = (rows) => rows.map(({ result: _result, ...rest }) => rest);
  const report = {
    pass: true,
    environment:
      'isolated local PostgreSQL; not production latency/fairness evidence',
    fixture: {
      small: { orders: 300, products: 20 },
      largeBefore: { orders: 1000, products: 100 },
      largeAfter: { orders: 100000, products: 20000 },
      empty: { orders: 0, products: 0 },
    },
    checks,
    before: compact(before),
    after: compact(after),
    concurrency,
    limitations:
      'Actual repository/service SQL with bounded runtime adapter. Pending/rejected data only. Mixed-load budgets are local regression checks, not production HTTP SLOs or proof of fairness at arbitrary saturation. Does not establish all-query coverage or paid/report throughput.',
  };
  await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
  await writeFile(
    process.env.TIMEOUT_DB_REPORT,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      { pass: report.pass, fixture: report.fixture, checks },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
  await setup.end();
}
