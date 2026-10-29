// Owned-cluster entry point only. Production bootstrap never exposes the marker.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, basename, sep } from 'node:path';
import { cpus, totalmem } from 'node:os';
import pg from 'pg';
import { LoadMonitor, assertLoadMonitoring } from './load-monitor.mjs';
import { runLoadSearchWorker } from './load-search.worker.mjs';
import { validateRampResponse } from './load-ramp.client-workload.mjs';
import {
  rampProfile,
  rampDiagnosticProfile,
  summarizeRamp,
} from './load-ramp.mjs';
import {
  loadDatasetPlan,
  seedLoadCatalog,
  seedLoadHistory,
  inspectLoadDataset,
} from './load-dataset.mjs';
import {
  connectLoadTarget,
  LOAD_MARKER_PATH,
} from '../../../scripts/load-target.mjs';

let phase = 'isolation';
async function main() {
  assert.equal(process.env.TIMEOUT_DB_LOCAL_FIXTURE, 'true');
  assert.equal(process.env.PASERVE_IGNORE_ENV_FILE, 'true');
  assert.equal(process.env.NODE_ENV, 'test');
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(
    database.hostname === '127.0.0.1' &&
      database.username === 'timeout_fixture' &&
      database.port &&
      /^[a-f0-9]{48}$/.test(database.password) &&
      database.pathname === '/postgres',
  );
  assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:1');
  const root = resolve(process.env.LOAD_FIXTURE_DIRECTORY);
  const toolsRoot = resolve(import.meta.dirname, '../../../.local-tools');
  assert.ok(
    root.startsWith(toolsRoot + sep) &&
      basename(root).startsWith('timeout-pg-'),
  );
  const runId = randomUUID(),
    token = randomBytes(32).toString('hex');
  const nativeFetch = globalThis.fetch;
  let origin;
  let blockedExternalCalls = 0;
  globalThis.fetch = (input, options = {}) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (!origin || url.origin !== origin) {
      blockedExternalCalls++;
      return Promise.reject(
        new Error('External HTTP is disabled in the load fixture.'),
      );
    }
    return nativeFetch(input, { ...options, redirect: 'error' });
  };
  const { ConfigService } = await import('@nestjs/config');
  const { PrismaClient } = await import('../dist/generated/prisma/client.js');
  const { BoundedPgAdapter } =
    await import('../dist/database/bounded-pg.adapter.js');
  const { databaseTimeouts } =
    await import('../dist/database/database-timeouts.js');
  const { databasePoolPolicy } =
    await import('../dist/database/database-pool.policy.js');
  const { PasswordHashService } =
    await import('../dist/modules/auth/password-hash.service.js');
  const deadlines = databaseTimeouts({});
  const prisma = new PrismaClient({
    adapter: new BoundedPgAdapter(
      { connectionString: database.href, ...deadlines.pool },
      databasePoolPolicy({}),
    ),
    transactionOptions: deadlines.transactionOptions,
  });
  const db = new pg.Client({ connectionString: database.href });
  let app;
  let credentialsFile;
  let cleanupFailed = false;
  let summary;
  let monitor;
  let monitoring;
  let reportWritten = false;
  try {
    phase = 'migrations';
    await db.connect();
    monitor = new LoadMonitor({
      maxSamples: process.env.LOAD_FIXTURE_RAMP === '1' ? 1080 : 480,
      client: new pg.Client({
        connectionString: database.href,
        application_name: 'paserve-load-monitor',
        statement_timeout: 1000,
        connectionTimeoutMillis: 1500,
      }),
      phase: () => phase,
      apiSnapshot: () =>
        app
          ? {
              pool: app.get(PrismaService).databasePoolSnapshot(),
              capacity: app.get(ApiCapacityService).snapshot(),
              fairness: app.get(TrafficFairnessService).snapshot(),
            }
          : null,
    });
    await monitor.start();
    await db.query(`SET TIME ZONE 'UTC'; ALTER DATABASE postgres SET timezone='UTC';
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE SCHEMA realtime; CREATE TABLE realtime.messages(topic text,event text,payload jsonb,private boolean);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages(payload,event,topic,private) VALUES($1,$2,$3,$4) $$;`);
    const databaseVersion = (await db.query('SHOW server_version')).rows[0]
      .server_version;
    const migrations = (
      await readdir(new URL('../prisma/migrations/', import.meta.url))
    )
      .filter((name) => /^\d/.test(name))
      .sort();
    for (const name of migrations)
      await db.query(
        await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    phase = 'synthetic-fixtures';
    const password = randomBytes(24).toString('hex');
    const passwordHash = await new PasswordHashService(
      new ConfigService(),
    ).hash(password);
    const plan = loadDatasetPlan(process.env.LOAD_DATASET_PROFILE);
    const anchor = new Date().toISOString();
    const { shops, accounts } = await seedLoadCatalog(prisma, plan, {
      runId,
      password,
      passwordHash,
    });
    phase = 'api-startup';
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    const { PrismaService } =
      await import('../dist/database/prisma.service.js');
    const { ApiCapacityService } =
      await import('../dist/common/load-shedding/api-capacity.service.js');
    const { TrafficFairnessService } =
      await import('../dist/common/load-shedding/traffic-fairness.service.js');
    const { configureSecurityHeaders } =
      await import('../dist/common/http/security-headers.js');
    const { configureTrustedProxy } =
      await import('../dist/common/http/trusted-proxy.js');
    const { configureRequestBody } =
      await import('../dist/common/http/request-body.js');
    const { configureServerTimeouts } =
      await import('../dist/common/http/server-timeouts.js');
    app = await NestFactory.create(AppModule, { logger: false });
    configureSecurityHeaders(app);
    configureTrustedProxy(app, '');
    configureRequestBody(app);
    configureServerTimeouts(app);
    app.setGlobalPrefix('api/v1');
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    app.use(LOAD_MARKER_PATH, (req, res) => {
      const supplied = req.headers['x-paserve-load-capability'];
      if (
        req.method !== 'GET' ||
        typeof supplied !== 'string' ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        return res.status(404).end();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        version: 1,
        runId,
        apiBaseUrl: `${origin}/api/v1/`,
        expiresAt,
        environment: 'disposable-development',
        fixturesOnly: true,
        externalServices: 'blocked',
      });
    });
    await app.listen(0, '127.0.0.1');
    monitor.attachHttp(app.getHttpServer());
    await monitor.sampleNow();
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const clientEnv = {
      LOAD_BASE_URL: `${origin}/api/v1/`,
      LOAD_RUN_ID: runId,
      LOAD_ENVIRONMENT_TOKEN: token,
    };
    phase = 'attestation-and-smoke';
    assert.equal(
      (await nativeFetch(new URL(LOAD_MARKER_PATH, origin))).status,
      404,
    );
    const client = await connectLoadTarget(clientEnv);
    const read = (path, options) =>
      client.fetch(new URL(path, client.base), options);
    let externalBlocked = false;
    try {
      await globalThis.fetch('https://external-fixture.invalid/');
    } catch {
      externalBlocked = true;
    }
    assert.ok(externalBlocked);
    const ids = [];
    const { TableContextService } =
      await import('../dist/modules/tables/table-context.service.js');
    for (const shop of shops) {
      const menu = await read(`menu/${shop.slug}`);
      assert.equal(menu.status, 200);
      const page = await menu.json();
      const account = accounts.find((a) => a.shopId === shop.id);
      account.slug = shop.slug;
      account.menuProductIds = page.products.map((p) => p.id);
      assert.ok(
        validateRampResponse('menu', page, account),
        'Synthetic menu response is invalid.',
      );
      assert.ok(page.products.length > 0 && page.products.length <= 100);
      assert.ok(page.products.some((item) => item.id === shop.product.id));
      const sources = [];
      for (const mode of ['TAKEOUT', 'DINE_IN']) {
        const requestId = randomUUID();
        const options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            mode,
            ...(mode === 'DINE_IN'
              ? {
                  tableCode: 'T1',
                  tableToken: app
                    .get(TableContextService)
                    .issue(shop.slug, 'T1'),
                }
              : {}),
            items: [
              {
                productId: shop.product.id,
                quantity: 2,
                variantIds: [shop.variant.id],
                addOnIds: [shop.addOn.id],
              },
              {
                productId: shop.product.id,
                quantity: 1,
                variantIds: [],
                addOnIds: [],
                notes: 'Synthetic less ice',
              },
            ],
          }),
        };
        const created = await read(`menu/${shop.slug}/orders`, options);
        assert.equal(created.status, 201);
        const order = await created.json();
        if (mode === 'TAKEOUT') {
          account.orderId = order.order.id;
          account.trackingCookie = created.headers
            .get('set-cookie')
            ?.split(';')[0];
        }
        ids.push(order.order.id);
        sources.push(order.order.id);
        const duplicate = await read(`menu/${shop.slug}/orders`, options);
        assert.equal(duplicate.status, 201);
        assert.equal((await duplicate.json()).order.id, order.order.id);
      }
      phase = 'history-fixtures';
      await db.query('SET statement_timeout=15000');
      await seedLoadHistory(db, shop, sources, anchor, (step) => {
        phase = `history-${shop.plan.tier}-${step}`;
      });
      phase = 'attestation-and-smoke';
    }
    const dataset = await inspectLoadDataset(db, shops, plan);
    await db.query('ANALYZE');
    await prisma.$disconnect();
    phase = 'optional-search';
    let search;
    const isRamp = process.env.LOAD_FIXTURE_RAMP === '1';
    const isDiagnostic = process.env.LOAD_RAMP_DIAGNOSTIC === '1';
    const profile = isDiagnostic ? rampDiagnosticProfile : rampProfile;
    if (process.env.LOAD_FIXTURE_SEARCH === '1' || isRamp) {
      credentialsFile = join(root, 'load-accounts.json');
      await writeFile(credentialsFile, JSON.stringify(accounts), {
        mode: 0o600,
        flag: 'wx',
      });
      await monitor.sampleNow();
      search = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_FIXTURE_RAMP: isRamp ? '1' : '0',
          LOAD_RAMP_DIAGNOSTIC: isDiagnostic ? '1' : '0',
          LOAD_LEVELS: isRamp ? rampProfile.levels.join(',') : '5',
          LOAD_DURATION_SECONDS: isRamp
            ? String(rampProfile.stageSeconds)
            : '10',
          LOAD_SEARCH_EVERY_MS: isRamp
            ? String(rampProfile.searchEveryMs)
            : '400',
          LOAD_POLL_EVERY_MS: isRamp ? String(rampProfile.pollEveryMs) : '1000',
          ...(isRamp
            ? {
                LOAD_P95_MS: String(rampProfile.p95Ms),
                LOAD_P99_MS: String(rampProfile.p99Ms),
              }
            : {}),
          LOAD_ENVIRONMENT: 'disposable-development',
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            isRamp
              ? isDiagnostic
                ? 'load-ramp-diagnostic-workload.json'
                : 'load-ramp-workload.json'
              : 'load-environment-search-workload.json',
          ),
        },
        {
          deadlineMs: isRamp ? 360000 : 60000,
          onStage: (stage) => {
            if (isRamp)
              phase =
                stage.type === 'start'
                  ? `ramp-${stage.virtualClients}`
                  : 'ramp-between-stages';
          },
        },
      );
      if (!isRamp) assert.ok(search.stages.every((stage) => stage.sloPass));
      assert.equal(search.testSessionsCreated, search.testSessionsRevoked);
    }
    phase = 'report';
    monitoring = await monitor.stop();
    assertLoadMonitoring(monitoring, {
      search: process.env.LOAD_FIXTURE_SEARCH === '1',
    });
    const ramp = isRamp ? summarizeRamp(search, monitoring, profile) : null;
    const report = {
      pass: ramp ? ramp.pass : true,
      ramp,
      runId,
      environment: 'disposable-development',
      database: 'owned loopback PostgreSQL cluster',
      externalServices: 'blocked; local storage/realtime SQL shims',
      synthetic: dataset.totals,
      monitoring,
      dataset: {
        ...dataset,
        anchorUtc: anchor,
        templatesCreatedThroughApi: ids.length,
      },
      migrations: migrations.length,
      checks: [
        'missing capability rejected',
        'matching target attested',
        'external HTTP refused before transport',
        'all three public menus read',
        'critical writes confined to fixture DB',
        'duplicate orders prevented',
      ],
      search: search
        ? {
            stages: search.stages.length,
            pass: search.stages.every((stage) => stage.sloPass),
          }
        : null,
      resources: {
        databaseVersion,
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        logicalCpus: cpus().length,
        cpuModel: cpus()[0]?.model ?? 'unknown',
        hostMemoryBytes: totalmem(),
        dbPoolPerApiInstance: databasePoolPolicy({}),
      },
      limitations:
        'Versioned synthetic planning baseline, not a production forecast or capacity claim. Host resources are observations, not deployment allocations. Parent removes its owned cluster after exit.',
    };
    await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
    await writeFile(
      process.env.TIMEOUT_DB_REPORT,
      JSON.stringify(report, null, 2) + '\n',
    );
    summary = {
      pass: report.pass,
      environment: report.environment,
      checks: report.checks.length,
      blockedExternalCalls,
      synthetic: report.synthetic,
    };
    reportWritten = true;
  } finally {
    try {
      if (monitor && !monitoring) monitoring = await monitor.stop();
      if (!reportWritten)
        await writeFile(
          process.env.TIMEOUT_DB_REPORT,
          JSON.stringify(
            {
              pass: false,
              environment: 'disposable-development',
              phase,
              monitoring,
            },
            null,
            2,
          ) + '\n',
        );
    } finally {
      const cleanup = await Promise.allSettled([
        credentialsFile ? unlink(credentialsFile) : Promise.resolve(),
        app ? app.close() : Promise.resolve(),
        prisma.$disconnect(),
        db.end(),
      ]);
      globalThis.fetch = nativeFetch;
      cleanupFailed = cleanup.some((result) => result.status === 'rejected');
    }
  }
  if (cleanupFailed) throw new Error('Fixture cleanup failed.');
  console.log(JSON.stringify(summary));
  if (!summary.pass)
    throw new Error('Load workload exceeded acceptance budgets.');
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      pass: false,
      phase,
      code:
        typeof error.code === 'string' ? error.code : 'FIXTURE_CHECK_FAILED',
      message: 'Disposable load environment check failed.',
    }),
  );
  process.exitCode = 1;
});
