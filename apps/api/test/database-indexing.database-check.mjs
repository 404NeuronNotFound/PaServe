// Real migrated tables and planner decisions; never reads a hosted database.
import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';

assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  'Use test:indexing:postgres; hosted databases are refused.',
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const migrationName = '20261028100000_tenant_query_indexes';
await db.connect();
try {
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE SCHEMA realtime; CREATE TABLE realtime.messages (topic text, event text, payload jsonb, private boolean);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS
    $$ INSERT INTO realtime.messages(payload,event,topic,private) VALUES ($1,$2,$3,$4) $$;`);
  for (const name of (
    await readdir(new URL('../prisma/migrations/', import.meta.url))
  )
    .filter((n) => /^\d/.test(n))
    .sort()) {
    if (name !== migrationName)
      await db.query(
        await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
  }
  // Twenty tenants: 100k orders, 80k products, 10k categories. All constraints,
  // tenant FKs, RLS definitions and application triggers remain installed.
  await db.query(`INSERT INTO shops (id,name,slug,"updatedAt")
    SELECT 's-'||s, 'Fixture '||s, 'index-fixture-'||s, now() FROM generate_series(1,20) s;
    INSERT INTO categories (id,"shopId",name,slug,"sortOrder","updatedAt")
    SELECT 'c-'||s||'-'||n, 's-'||s, 'Category '||n, 'category-'||n, n%37, now()
    FROM generate_series(1,20) s CROSS JOIN generate_series(1,500) n;
    INSERT INTO products (id,"shopId","categoryId",name,slug,price,"sortOrder","isArchived","updatedAt")
    SELECT 'p-'||s||'-'||n, 's-'||s, 'c-'||s||'-'||(1+n%500), 'Product '||n,
      'product-'||n, 10, n%37, n%7=0, now()
    FROM generate_series(1,20) s CROSS JOIN generate_series(1,4000) n;
    INSERT INTO orders (id,"shopId","requestId","requestHash",mode,status,"totalPrice",items,"orderNumber",
      "qrTokenNonce","qrTokenExpiresAt","createdAt","decidedAt","decidedBy","qrTokenRevokedAt")
    SELECT 'o-'||s||'-'||n,'s-'||s,gen_random_uuid()::text,repeat('a',64),'TAKEOUT',
      CASE WHEN n%10=0 THEN 'PENDING_CONFIRMATION' ELSE 'REJECTED' END,
      10,'[{}]'::jsonb,'ORD-'||lpad(n::text,6,'0'),gen_random_uuid()::text,now()+interval '1 day',
      timestamp '2026-01-01'+n*interval '1 minute',
      CASE WHEN n%10<>0 THEN now() END,CASE WHEN n%10<>0 THEN 'fixture-actor' END,
      CASE WHEN n%10<>0 THEN now() END
    FROM generate_series(1,20) s CROSS JOIN generate_series(1,5000) n;`);
  const analyze = () =>
    db.query(
      'ANALYZE orders; ANALYZE products; ANALYZE categories; ANALYZE shops;',
    );
  await analyze();
  // Predicate/sort shapes mirror the repositories. Full catalog reads remain
  // full reads: no artificial LIMIT to manufacture a planner win.
  const queries = [
    [
      'pending orders',
      `SELECT id,"shopId","createdAt" FROM orders WHERE "shopId"=$1 AND status='PENDING_CONFIRMATION' ORDER BY "createdAt",id LIMIT 26`,
      ['s-1'],
    ],
    [
      'rejected history',
      `SELECT id,"shopId","createdAt" FROM orders WHERE "shopId"=$1 AND status='REJECTED' AND "paymentStatus"='UNPAID' AND "preparationStatus" IS NULL AND "completedAt" IS NULL AND currency='PHP' ORDER BY "createdAt" DESC,id DESC LIMIT 26`,
      ['s-1'],
    ],
    [
      'pending orders next page',
      `SELECT id,"shopId","createdAt" FROM orders WHERE "shopId"=$1 AND status='PENDING_CONFIRMATION' AND ("createdAt">$2 OR ("createdAt"=$2 AND id>$3)) ORDER BY "createdAt",id LIMIT 26`,
      ['s-1', '2026-01-02T00:00:00Z', 'o-1-1440'],
    ],
    [
      'active orders',
      `SELECT id,"shopId","createdAt" FROM orders WHERE "shopId"=$1 AND status IN ('PENDING_CONFIRMATION','CONFIRMED') AND "completedAt" IS NULL AND ("preparationStatus" IS NULL OR "preparationStatus" IN ('QUEUED','PREPARING','READY')) ORDER BY "createdAt",id LIMIT 26`,
      ['s-1'],
    ],
    [
      'categories',
      `SELECT id,"shopId",name,"sortOrder" FROM categories WHERE "shopId"=$1 ORDER BY "sortOrder","createdAt",id`,
      ['s-1'],
    ],
    [
      'product management',
      `SELECT id,"shopId",name,price,status,"isArchived","sortOrder" FROM products WHERE "shopId"=$1 ORDER BY "sortOrder","createdAt",id`,
      ['s-1'],
    ],
    [
      'public menu products',
      `SELECT p.id,p."shopId",p.name,p.price,p."sortOrder" FROM products p WHERE p."shopId"=$1 AND p."isArchived"=false AND p.status IN ('AVAILABLE','SOLD_OUT') AND (p."categoryId" IS NULL OR EXISTS (SELECT 1 FROM categories c WHERE c.id=p."categoryId" AND c."shopId"=$1 AND c."isVisible"=true)) ORDER BY p."sortOrder",p."createdAt",p.id`,
      ['s-1'],
    ],
    [
      'category reorder',
      `SELECT id,"shopId" FROM products WHERE "shopId"=$1 AND "categoryId"=$2 AND "isArchived"=false ORDER BY "sortOrder","createdAt",id`,
      ['s-1', 'c-1-2'],
    ],
  ];
  const plans = async () => {
    const results = [];
    for (const [name, sql, values] of queries) {
      const rows = (await db.query(sql, values)).rows;
      assert.ok(
        rows.length > 0 && rows.every((row) => row.shopId === 's-1'),
        `${name}: nonempty tenant-scoped fixture`,
      );
      const explain = (
        await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, values)
      ).rows[0]['QUERY PLAN'][0];
      const nodes = [];
      const walk = (node) => {
        nodes.push({
          type: node['Node Type'],
          index: node['Index Name'],
          rows: node['Actual Rows'],
          removed: node['Rows Removed by Filter'] ?? 0,
        });
        (node.Plans ?? []).forEach(walk);
      };
      walk(explain.Plan);
      results.push({
        name,
        rows,
        executionMs: explain['Execution Time'],
        buffers:
          explain.Plan['Shared Hit Blocks'] +
          explain.Plan['Shared Read Blocks'],
        nodes,
      });
    }
    return results;
  };
  const before = await plans();
  const migrationSql = await readFile(
    new URL(
      `../prisma/migrations/${migrationName}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  );
  // Committed writes on real migrated tables, including constraints and triggers.
  // One warmup + five measured batches per state. Every operation returns its
  // affected rows in EXPLAIN so missing writes cannot masquerade as fast writes.
  const writeSamples = async () => {
    const samples = [];
    for (let trial = 0; trial < 6; trial++) {
      const operations = [];
      const started = performance.now();
      await db.query('BEGIN');
      try {
        for (const [name, sql] of [
          [
            'order insert',
            `INSERT INTO orders (id,"shopId","requestId","requestHash",mode,"totalPrice",items,"orderNumber","qrTokenNonce","qrTokenExpiresAt")
            SELECT 'write-order-'||n,'s-1',gen_random_uuid()::text,repeat('a',64),'TAKEOUT',10,'[{}]'::jsonb,
              'ORD-'||(900000+n),gen_random_uuid()::text,now()+interval '1 day' FROM generate_series(1,100) n RETURNING id`,
          ],
          [
            'order status transition',
            `UPDATE orders SET status='REJECTED',"decidedAt"=now(),"decidedBy"='fixture-actor',"qrTokenRevokedAt"=now(),"updatedAt"=now()
            WHERE "shopId"='s-1' AND id LIKE 'write-order-%' AND status='PENDING_CONFIRMATION' RETURNING id`,
          ],
          [
            'product insert',
            `INSERT INTO products (id,"shopId","categoryId",name,slug,price,"sortOrder","updatedAt")
            SELECT 'write-product-'||n,'s-1','c-1-2','Write fixture '||n,'write-product-'||n,10,n,now() FROM generate_series(1,100) n RETURNING id`,
          ],
          [
            'product reorder',
            `UPDATE products SET "sortOrder"="sortOrder"+100,"updatedAt"=now()
            WHERE "shopId"='s-1' AND id LIKE 'write-product-%' AND "categoryId"='c-1-2' AND "isArchived"=false RETURNING id`,
          ],
        ]) {
          const plan = (
            await db.query(
              'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ' + sql,
            )
          ).rows[0]['QUERY PLAN'][0];
          assert.equal(
            plan.Plan['Actual Rows'],
            100,
            `${name}: expected 100 writes`,
          );
          operations.push({
            name,
            rows: 100,
            executionMs: plan['Execution Time'],
            walBytes: plan.Plan['WAL Bytes'] ?? 0,
            buffers:
              (plan.Plan['Shared Hit Blocks'] ?? 0) +
              (plan.Plan['Shared Read Blocks'] ?? 0),
          });
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
      const committedBatchMs = performance.now() - started;
      // Cleanup is outside measurement. Only this fixture's extra tenant rows.
      await db.query(`DELETE FROM orders WHERE "shopId"='s-1' AND id LIKE 'write-order-%';
        DELETE FROM products WHERE "shopId"='s-1' AND id LIKE 'write-product-%';`);
      if (trial > 0) samples.push({ committedBatchMs, operations });
    }
    return samples;
  };
  const writesBefore = await writeSamples();
  await db.query(
    await readFile(
      new URL(
        `../prisma/migrations/${migrationName}/migration.sql`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await analyze();
  const after = await plans();
  const writesAfter = await writeSamples();
  // Reverse the comparison order once to expose warm-cache/order bias. Only
  // the two new non-unique indexes are dropped, in this disposable cluster.
  const writesAfterRepeat = await writeSamples();
  await db.query(
    'DROP INDEX orders_shop_status_created_idx; DROP INDEX products_shop_category_sort_idx;',
  );
  const writesBeforeRepeat = await writeSamples();
  await db.query(migrationSql);
  await analyze();
  const finalPlans = await plans();
  for (let i = 0; i < after.length; i++)
    assert.deepEqual(finalPlans[i].rows, after[i].rows);
  for (let i = 0; i < after.length; i++)
    assert.deepEqual(
      after[i].rows,
      before[i].rows,
      'Indexes must preserve ordering, results and tenant scope',
    );
  // Real planner choice, default planner settings (including sequential scans).
  for (const [name, expectedIndex] of [
    ['pending orders', 'orders_shop_status_created_idx'],
    ['pending orders next page', 'orders_shop_status_created_idx'],
    ['rejected history', 'orders_shop_status_created_idx'],
    ['category reorder', 'products_shop_category_sort_idx'],
  ]) {
    const result = after.find((r) => r.name === name);
    assert.ok(
      result.nodes.some((n) => n.index === expectedIndex),
      `${name}: expected tenant index`,
    );
    assert.ok(
      !result.nodes.some((n) => n.type === 'Sort'),
      `${name}: index must supply sort order`,
    );
  }
  for (const name of ['pending orders', 'rejected history']) {
    assert.ok(
      after.find((r) => r.name === name).buffers <
        before.find((r) => r.name === name).buffers / 2,
      `${name}: bounded page must reduce buffer accesses`,
    );
  }
  // Confirm the selected index remains usable with a generic prepared plan;
  // no dependence on literal-only partial-index predicates.
  await db.query(`SET plan_cache_mode=force_generic_plan; PREPARE indexing_pending(text,text) AS
    SELECT id FROM orders WHERE "shopId"=$1 AND status=$2 ORDER BY "createdAt",id LIMIT 26;`);
  const generic = (
    await db.query(
      "EXPLAIN (FORMAT JSON) EXECUTE indexing_pending('s-1','PENDING_CONFIRMATION')",
    )
  ).rows[0]['QUERY PLAN'][0];
  assert.ok(JSON.stringify(generic).includes('orders_shop_status_created_idx'));
  await db.query('DEALLOCATE indexing_pending; RESET plan_cache_mode;');
  const sizes = (
    await db.query(`SELECT indexrelname,pg_relation_size(indexrelid)::int AS bytes FROM pg_stat_user_indexes WHERE indexrelname IN
    ('orders_shop_status_created_idx','products_shop_category_sort_idx') ORDER BY indexrelname`)
  ).rows;
  assert.equal(sizes.length, 2);
  const compact = (results) =>
    results.map(({ rows, ...rest }) => ({ ...rest, resultCount: rows.length }));
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  };
  const baselineWrites = [...writesBefore, ...writesBeforeRepeat];
  const indexedWrites = [...writesAfter, ...writesAfterRepeat];
  const writeComparison = writesBefore[0].operations.map(({ name }) => {
    const summarize = (samples) => {
      const operations = samples.map((sample) =>
        sample.operations.find((op) => op.name === name),
      );
      return {
        medianExecutionMs: median(operations.map((op) => op.executionMs)),
        medianWalBytes: median(operations.map((op) => op.walBytes)),
        medianBuffers: median(operations.map((op) => op.buffers)),
      };
    };
    const baseline = summarize(baselineWrites),
      indexed = summarize(indexedWrites);
    return {
      name,
      rowsPerSample: 100,
      baseline,
      indexed,
      executionChangePercent:
        100 * (indexed.medianExecutionMs / baseline.medianExecutionMs - 1),
    };
  });
  const report = {
    pass: true,
    environment: 'disposable local PostgreSQL; not production latency evidence',
    fixture: { shops: 20, orders: 100000, products: 80000, categories: 10000 },
    before: compact(before),
    after: compact(after),
    genericPreparedPlanPass: true,
    indexSizes: sizes,
    writes: {
      pass: true,
      sequence: 'baseline, indexed, indexed, baseline; indexes restored at end',
      measuredSamplesPerState: 10,
      warmupsPerState: 2,
      committedBatchMedianMs: {
        baseline: median(baselineWrites.map((s) => s.committedBatchMs)),
        indexed: median(indexedWrites.map((s) => s.committedBatchMs)),
      },
      comparison: writeComparison,
      raw: { baseline: baselineWrites, indexed: indexedWrites },
      limitations:
        'Local sequential 100-row batches with EXPLAIN overhead and transactional realtime shim; no production throughput or payment-transition claim.',
    },
  };
  await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
  await writeFile(
    process.env.TIMEOUT_DB_REPORT,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.end();
}
