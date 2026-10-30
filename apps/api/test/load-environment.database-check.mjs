// Owned-cluster entry point only. Production bootstrap never exposes the marker.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  readdir,
  readFile,
  mkdir,
  writeFile,
  unlink,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve, basename, sep } from 'node:path';
import { cpus, totalmem } from 'node:os';
import pg from 'pg';
import { LoadMonitor, assertLoadMonitoring } from './load-monitor.mjs';
import { runLoadSearchWorker } from './load-search.worker.mjs';
import { validateRampResponse } from './load-ramp.client-workload.mjs';
import { evaluateLoginFlood } from './login-flood.metrics.mjs';
import { evaluateMenuSpike } from './menu-spike.metrics.mjs';
import { menuSpikeStages } from './menu-spike.workload.mjs';
import { auditOrderBurst, evaluateOrderBurst } from './order-burst.metrics.mjs';
import { orderBurstStages } from './order-burst.workload.mjs';
import { spikeProfile } from './load-spike.workload.mjs';
import { evaluateTrafficSpike } from './load-spike.metrics.mjs';
import { soakProfile, soakSeconds } from './load-soak.profile.mjs';
import { evaluateSoak } from './load-soak.metrics.mjs';
import { soakLogs } from './load-soak.logs.mjs';
import {
  instrumentOrderTransactions,
  summarizeOrderTransactions,
} from './order-burst.instrumentation.mjs';
import {
  loginFloodProfile,
  loginFloodSource,
} from './login-flood.workload.mjs';
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
  let privateResultsFile;
  let orderTransactions;
  let cleanupFailed = false;
  let summary;
  let monitor;
  let monitoring;
  let reportWritten = false;
  const isLoginFlood = process.env.LOAD_LOGIN_FLOOD === '1';
  const isMenuSpike = process.env.LOAD_MENU_SPIKE === '1';
  const isOrderBurst = process.env.LOAD_ORDER_BURST === '1';
  const isTrafficSpike = process.env.LOAD_TRAFFIC_SPIKE === '1';
  const soak = process.env.LOAD_SOAK_PROFILE
    ? soakProfile(process.env.LOAD_SOAK_PROFILE)
    : null;
  const spikeCache = {};
  const logCapture = soak ? soakLogs() : null;
  logCapture?.install();
  const floodCounters = {
    targetAccountReads: 0,
    peers: { attacker: 0, legitimate: 0, other: 0 },
  };
  const floodPeerSources = new Set();
  const orderErrors = [];
  const trafficProtection = {};
  try {
    phase = 'migrations';
    await db.connect();
    monitor = new LoadMonitor({
      intervalMs: soak
        ? 1000
        : isMenuSpike
          ? 50
          : isLoginFlood || isOrderBurst || isTrafficSpike
            ? 100
            : 500,
      maxSamples: soak
        ? soakSeconds(soak) + 250
        : isMenuSpike
          ? 4000
          : isLoginFlood || isOrderBurst || isTrafficSpike
            ? 2400
            : process.env.LOAD_FIXTURE_RAMP === '1'
              ? 1080
              : 480,
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
              passwords: app.get(PasswordHashService).snapshot(),
              ...(soak
                ? {
                    soakResources: Object.fromEntries(
                      [...new Set(process.getActiveResourcesInfo())].map(
                        (name) => [
                          name,
                          process
                            .getActiveResourcesInfo()
                            .filter((value) => value === name).length,
                        ],
                      ),
                    ),
                    soakLogs: logCapture.snapshot(),
                  }
                : {}),
              ...(isMenuSpike || isTrafficSpike || soak
                ? {
                    menuCache: app.get(PublicMenuCache).snapshot(),
                    menuGate: app.get(PublicMenuReadGate).snapshot(),
                  }
                : {}),
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
    if (isOrderBurst) {
      const { ApiExceptionFilter } =
        await import('../dist/common/filters/api-exception.filter.js');
      // The original method is intentionally invoked below with the filter receiver.
      // oxlint-disable-next-line typescript/unbound-method
      const originalCatch = ApiExceptionFilter.prototype.catch;
      ApiExceptionFilter.prototype.catch = function (error, host) {
        if (orderErrors.length < 16 && !error.getStatus)
          orderErrors.push({
            name: error.name,
            code: error.code,
            adapterKind: error.cause?.kind,
            sqlState: error.meta?.driverAdapterError?.cause?.originalCode,
            // Only source frames; never error text, SQL, parameters or request data.
            frames: error.stack
              ?.split('\n')
              .filter((line) => /^\s+at /.test(line))
              .slice(0, 4),
          });
        return originalCatch.call(this, error, host);
      };
    }
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    const { PrismaService } =
      await import('../dist/database/prisma.service.js');
    const { ApiCapacityService } =
      await import('../dist/common/load-shedding/api-capacity.service.js');
    const { TrafficFairnessService } =
      await import('../dist/common/load-shedding/traffic-fairness.service.js');
    const { PublicMenuCache } =
      await import('../dist/modules/categories/public-menu-cache.js');
    const { PublicMenuReadGate } =
      await import('../dist/modules/categories/public-menu-read-gate.js');
    const { configureSecurityHeaders } =
      await import('../dist/common/http/security-headers.js');
    const { configureTrustedProxy } =
      await import('../dist/common/http/trusted-proxy.js');
    const { configureRequestBody } =
      await import('../dist/common/http/request-body.js');
    const { configureServerTimeouts } =
      await import('../dist/common/http/server-timeouts.js');
    app = await NestFactory.create(AppModule, {
      logger: logCapture?.logger ?? false,
    });
    configureSecurityHeaders(app);
    configureTrustedProxy(app, '');
    configureRequestBody(app);
    configureServerTimeouts(app);
    app.use((req, _res, next) => {
      if (
        isLoginFlood &&
        phase === 'login-flood-attack' &&
        req.method === 'POST' &&
        req.url === '/api/v1/auth/login'
      ) {
        const ip = req.socket.remoteAddress;
        const botSource = Array.from(
          { length: loginFloodProfile.clients },
          (_, i) => loginFloodSource(i),
        ).includes(ip);
        if (botSource) floodPeerSources.add(ip);
        floodCounters.peers[
          botSource
            ? 'attacker'
            : ['127.0.0.3', '127.0.0.4', '127.0.0.5', '127.0.0.6'].includes(ip)
              ? 'legitimate'
              : 'other'
        ]++;
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    let expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
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
      account.menuCategoryIds = page.categories.map((c) => c.id);
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
    let trafficBefore, trafficAccounts;
    if (isTrafficSpike || soak) {
      trafficBefore = {
        orders: await prisma.order.count(),
        lines: await prisma.orderItem.count(),
        users: await prisma.user.count(),
        paid: await prisma.order.count({ where: { paymentStatus: 'PAID' } }),
        products: await prisma.product.findMany({
          select: { id: true, status: true, isArchived: true },
          orderBy: { id: 'asc' },
        }),
      };
      trafficAccounts = await Promise.all(
        accounts.map(async (account, i) => ({
          ...account,
          productId: shops[i].product.id,
          variantId: shops[i].variant.id,
          addOnId: shops[i].addOn.id,
          categoryIds: account.menuCategoryIds,
          kitchenIds: (
            await prisma.order.findMany({
              where: {
                shopId: account.shopId,
                status: 'CONFIRMED',
                paymentStatus: 'PAID',
                preparationStatus: 'QUEUED',
                queuedAt: { not: null },
              },
              orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
              take: 50,
              select: { id: true },
            })
          ).map((order) => order.id),
        })),
      );
    }
    let spikeFixture, spikeBefore;
    let burstFixture, burstBefore;
    if (isOrderBurst) {
      const staff = await prisma.user.findUniqueOrThrow({
        where: { id: shops[0].actors.CASHIER },
        select: { id: true, email: true },
      });
      burstFixture = {
        shops: await Promise.all(
          shops.map(async (shop) => ({
            shopId: shop.id,
            slug: shop.slug,
            productId: shop.product.id,
            variantId: shop.variant.id,
            addOnId: shop.addOn.id,
            tableId: (
              await prisma.restaurantTable.findFirstOrThrow({
                where: { shopId: shop.id, code: 'T1' },
                select: { id: true },
              })
            ).id,
          })),
        ),
        staff: { ...staff, password, shopId: shops[0].id },
        probeStaff: await Promise.all(
          [0, 2].flatMap((tenant) =>
            ['CASHIER', 'KITCHEN'].map(async (role) => ({
              ...(await prisma.user.findUniqueOrThrow({
                where: { id: shops[tenant].actors[role] },
                select: { id: true, email: true },
              })),
              tenant,
              role,
              password,
              shopId: shops[tenant].id,
              kitchenIds:
                role === 'KITCHEN'
                  ? (
                      await prisma.order.findMany({
                        where: {
                          shopId: shops[tenant].id,
                          status: 'CONFIRMED',
                          paymentStatus: 'PAID',
                          preparationStatus: 'QUEUED',
                          queuedAt: { not: null },
                        },
                        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
                        take: 50,
                        select: { id: true },
                      })
                    ).map((order) => order.id)
                  : undefined,
            })),
          ),
        ),
      };
      burstBefore = {
        orders: await prisma.order.count(),
        lines: await prisma.orderItem.count(),
        paid: await prisma.order.count({ where: { paymentStatus: 'PAID' } }),
        users: await prisma.user.count(),
        counters: await Promise.all(
          shops.map(
            async (shop) =>
              (
                await prisma.shop.findUniqueOrThrow({
                  where: { id: shop.id },
                  select: { lastOrderNumber: true },
                })
              ).lastOrderNumber,
          ),
        ),
      };
    }
    if (isMenuSpike) {
      const staff = await prisma.user.findUniqueOrThrow({
        where: { id: shops[0].actors.CASHIER },
        select: { id: true, email: true },
      });
      spikeFixture = {
        shops: accounts.map((a, i) => ({
          slug: a.slug,
          shopId: a.shopId,
          menuProductIds: a.menuProductIds,
          categoryIds: a.menuCategoryIds,
          productId: shops[i].product.id,
          variantId: shops[i].variant.id,
          addOnId: shops[i].addOn.id,
        })),
        staff: { ...staff, password, shopId: shops[0].id },
      };
      spikeBefore = {
        users: await prisma.user.count(),
        orders: await prisma.order.count(),
        products: await prisma.product.findMany({
          where: { id: { in: shops.map((s) => s.product.id) } },
          select: { id: true, shopId: true, status: true, isArchived: true },
          orderBy: { id: 'asc' },
        }),
      };
    }
    let floodFixture, floodBefore;
    if (isLoginFlood) {
      const actors = [];
      for (const [i, role] of ['OWNER', 'CASHIER', 'OWNER'].entries()) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: shops[i].actors[role] },
          select: { id: true, email: true },
        });
        actors.push({
          ...user,
          password,
          role,
          shopId: shops[i].id,
          slug: shops[i].slug,
        });
      }
      const attacker = await prisma.user.findUniqueOrThrow({
        where: { id: shops[0].actors.ADMIN },
        select: { id: true, email: true, passwordHash: true, updatedAt: true },
      });
      floodFixture = {
        actors,
        attacker: { id: attacker.id, email: attacker.email },
        missingEmail: `missing-${runId}@load.example.test`,
      };
      floodBefore = {
        attacker,
        users: await prisma.user.count(),
        hashes: app.get(PasswordHashService).snapshot().verifyJobs,
        external: blockedExternalCalls,
        victim: await prisma.user.findUniqueOrThrow({
          where: { id: actors[0].id },
          select: { email: true, passwordHash: true, isActive: true },
        }),
      };
      const { AuthRepository } =
        await import('../dist/modules/auth/auth.repository.js');
      const repository = app.get(AuthRepository);
      const find = repository.findLoginAccount.bind(repository);
      repository.findLoginAccount = (email) => {
        if ([actors[0].email].includes(email.trim().toLowerCase()))
          floodCounters.targetAccountReads++;
        return find(email);
      };
    }
    await prisma.$disconnect();
    phase = 'optional-search';
    let search;
    let floodWorkload, loginFlood;
    let spikeWorkload, menuSpike;
    let trafficWorkload, trafficSpike;
    let soakWorkload, soakResult, soakSetupLogs, soakDatabaseLogOffset;
    if (soak) {
      credentialsFile = join(root, 'load-accounts.json');
      await writeFile(credentialsFile, JSON.stringify(trafficAccounts), {
        mode: 0o600,
        flag: 'wx',
      });
      soakSetupLogs = logCapture.begin();
      soakDatabaseLogOffset = (await stat(join(root, 'postgres.log'))).size;
      soakWorkload = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_SOAK_PROFILE: soak.name,
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            `load-soak-${soak.name}-workload-local.json`,
          ),
        },
        {
          deadlineMs: (soakSeconds(soak) + 60) * 1000,
          onStage: async (stage) => {
            assert.ok(
              [
                'soak-warmup',
                'soak-cooldown',
                ...Array.from(
                  { length: soak.windows },
                  (_, i) => `soak-window-${i}`,
                ),
              ].includes(stage.phase),
            );
            phase = stage.phase;
            expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
            await monitor.sampleNow();
            const memory = process.memoryUsage();
            await writeFile(
              resolve(
                dirname(process.env.TIMEOUT_DB_REPORT),
                `load-soak-${soak.name}-progress-local.json`,
              ),
              JSON.stringify({
                runId,
                profile: soak.name,
                phase,
                status: 'running',
                at: new Date().toISOString(),
                memory: {
                  rssBytes: memory.rss,
                  heapUsedBytes: memory.heapUsed,
                  externalBytes: memory.external,
                },
                pool: app.get(PrismaService).databasePoolSnapshot(),
              }) + '\n',
            );
            assert.ok(
              memory.rss <= soak.maxRssBytes &&
                memory.heapUsed <= soak.maxHeapBytes &&
                memory.external <= soak.maxExternalBytes,
              'Soak resource ceiling exceeded.',
            );
          },
        },
      );
    }
    if (isTrafficSpike) {
      credentialsFile = join(root, 'load-accounts.json');
      await writeFile(credentialsFile, JSON.stringify(trafficAccounts), {
        mode: 0o600,
        flag: 'wx',
      });
      trafficWorkload = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_TRAFFIC_SPIKE: '1',
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            'load-spike-workload-local.json',
          ),
        },
        {
          onStage: async (stage) => {
            assert.ok(
              [...spikeProfile.phases, 'overload', 'overload-recovery'].some(
                (name) => stage.phase === `traffic-spike-${name}`,
              ),
            );
            phase = stage.phase;
            const snapshot = () => ({
              gate: app.get(PublicMenuReadGate).snapshot(),
              capacity: app.get(ApiCapacityService).snapshot(),
              pool: app.get(PrismaService).databasePoolSnapshot(),
              passwords: app.get(PasswordHashService).snapshot(),
            });
            if (stage.phase === 'traffic-spike-overload')
              trafficProtection[stage.type === 'start' ? 'before' : 'after'] =
                snapshot();
            if (
              stage.phase === 'traffic-spike-overload-recovery' &&
              stage.type === 'complete'
            )
              trafficProtection.recovered = snapshot();
            await monitor.sampleNow();
          },
        },
      );
    }
    let burstWorkload, orderBurst;
    if (isOrderBurst) {
      credentialsFile = join(root, 'load-accounts.json');
      const { OrdersService } =
        await import('../dist/modules/orders/orders.service.js');
      orderTransactions = instrumentOrderTransactions(
        app.get(OrdersService),
        app.get(PrismaService),
        () => phase,
      );
      privateResultsFile = join(root, 'order-burst-records.json');
      await writeFile(credentialsFile, JSON.stringify(burstFixture), {
        mode: 0o600,
        flag: 'wx',
      });
      burstWorkload = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_ORDER_BURST: '1',
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_PRIVATE_RESULTS: privateResultsFile,
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            'order-burst-workload-local.json',
          ),
        },
        {
          onStage: async (stage) => {
            assert.ok(
              orderBurstStages
                .map((name) => `order-burst-${name}`)
                .includes(stage.phase),
            );
            phase = stage.phase;
            await monitor.sampleNow();
          },
        },
      );
    }
    if (isMenuSpike) {
      credentialsFile = join(root, 'load-accounts.json');
      await writeFile(credentialsFile, JSON.stringify(spikeFixture), {
        mode: 0o600,
        flag: 'wx',
      });
      spikeWorkload = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_MENU_SPIKE: '1',
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            'menu-spike-workload-local.json',
          ),
        },
        {
          onStage: async (stage) => {
            assert.ok(
              menuSpikeStages
                .map((name) => `menu-spike-${name}`)
                .includes(stage.phase),
            );
            phase = stage.phase;
            const name = stage.phase.slice('menu-spike-'.length);
            const cache = app.get(PublicMenuCache);
            if (stage.type === 'start') {
              if (stage.clearMenuCache) cache.clear();
              spikeCache[name] = {
                before: cache.snapshot(),
                explicitlyCleared: Boolean(stage.clearMenuCache),
              };
              spikeCache[name].revisionBefore = (
                await db.query(
                  'SELECT version FROM menu_cache_versions WHERE "shopId"=$1',
                  [shops[0].id],
                )
              ).rows[0].version;
              await monitor.sampleNow();
            } else {
              await monitor.sampleNow();
              spikeCache[name].after = cache.snapshot();
              spikeCache[name].revisionChanged =
                spikeCache[name].revisionBefore !==
                (
                  await db.query(
                    'SELECT version FROM menu_cache_versions WHERE "shopId"=$1',
                    [shops[0].id],
                  )
                ).rows[0].version;
              delete spikeCache[name].revisionBefore;
            }
          },
        },
      );
    }
    if (isLoginFlood) {
      credentialsFile = join(root, 'load-accounts.json');
      await writeFile(credentialsFile, JSON.stringify(floodFixture), {
        mode: 0o600,
        flag: 'wx',
      });
      floodWorkload = await runLoadSearchWorker(
        {
          ...clientEnv,
          LOAD_LOGIN_FLOOD: '1',
          LOAD_ACCOUNTS_FILE: credentialsFile,
          LOAD_REPORT: resolve(
            dirname(process.env.TIMEOUT_DB_REPORT),
            'login-flood-workload-local.json',
          ),
        },
        {
          deadlineMs: 60000,
          onStage: (stage) => {
            phase = stage.phase;
          },
        },
      );
    }
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
    if (isLoginFlood) {
      await prisma.$connect();
      const attacker = await prisma.user.findUniqueOrThrow({
        where: { id: floodFixture.attacker.id },
        select: { id: true, email: true, passwordHash: true, updatedAt: true },
      });
      loginFlood = evaluateLoginFlood(floodWorkload, monitoring, {
        ...floodCounters,
        distinctAttackSources: floodPeerSources.size,
        victimUnchanged:
          JSON.stringify(
            await prisma.user.findUniqueOrThrow({
              where: { id: floodFixture.actors[0].id },
              select: { email: true, passwordHash: true, isActive: true },
            }),
          ) === JSON.stringify(floodBefore.victim),
        victimSessionRows: await prisma.authSession.count({
          where: { userId: floodFixture.actors[0].id },
        }),
        hashVerifyJobs:
          app.get(PasswordHashService).snapshot().verifyJobs -
          floodBefore.hashes,
        attackerSessions: await prisma.authSession.count({
          where: { userId: attacker.id },
        }),
        attackerUnchanged:
          JSON.stringify(attacker) === JSON.stringify(floodBefore.attacker),
        usersUnchanged: (await prisma.user.count()) === floodBefore.users,
        sessionRows: await prisma.authSession.count(),
        revokedRows: await prisma.authSession.count({
          where: { revokedAt: { not: null } },
        }),
        externalCallsDuringWorkload:
          blockedExternalCalls - floodBefore.external,
      });
    }
    const ramp = isRamp ? summarizeRamp(search, monitoring, profile) : null;
    if (isMenuSpike) {
      await prisma.$connect();
      menuSpike = evaluateMenuSpike(spikeWorkload, monitoring, {
        cache: spikeCache,
        usersUnchanged: (await prisma.user.count()) === spikeBefore.users,
        ordersUnchanged: (await prisma.order.count()) === spikeBefore.orders,
        availabilityRestored:
          JSON.stringify(
            await prisma.product.findMany({
              where: { id: { in: shops.map((s) => s.product.id) } },
              select: {
                id: true,
                shopId: true,
                status: true,
                isArchived: true,
              },
              orderBy: { id: 'asc' },
            }),
          ) === JSON.stringify(spikeBefore.products),
        sessionRows: await prisma.authSession.count(),
        revokedRows: await prisma.authSession.count({
          where: { revokedAt: { not: null } },
        }),
      });
    }
    if (isOrderBurst) {
      const records = JSON.parse(await readFile(privateResultsFile, 'utf8'));
      assert.equal(burstWorkload.runId, runId);
      const { OrderTokenService } =
        await import('../dist/modules/orders/order-token.service.js');
      orderBurst = evaluateOrderBurst(
        burstWorkload,
        monitoring,
        await auditOrderBurst(
          db,
          burstFixture,
          burstBefore,
          records,
          app.get(OrderTokenService),
        ),
        summarizeOrderTransactions(orderTransactions),
      );
    }
    if (isTrafficSpike) {
      assert.equal(trafficWorkload.runId, runId);
      await prisma.$connect();
      trafficSpike = evaluateTrafficSpike(trafficWorkload, monitoring, {
        protection: trafficProtection,
        ordersUnchanged: (await prisma.order.count()) === trafficBefore.orders,
        linesUnchanged:
          (await prisma.orderItem.count()) === trafficBefore.lines,
        usersUnchanged: (await prisma.user.count()) === trafficBefore.users,
        paidUnchanged:
          (await prisma.order.count({ where: { paymentStatus: 'PAID' } })) ===
          trafficBefore.paid,
        productsUnchanged:
          JSON.stringify(
            await prisma.product.findMany({
              select: { id: true, status: true, isArchived: true },
              orderBy: { id: 'asc' },
            }),
          ) === JSON.stringify(trafficBefore.products),
        sessions: await prisma.authSession.count(),
        revoked: await prisma.authSession.count({
          where: { revokedAt: { not: null } },
        }),
      });
    }
    if (soak) {
      assert.equal(soakWorkload.runId, runId);
      await prisma.$connect();
      soakResult = evaluateSoak(soakWorkload, monitoring, {
        logs: logCapture.snapshot(),
        ordersUnchanged: (await prisma.order.count()) === trafficBefore.orders,
        linesUnchanged:
          (await prisma.orderItem.count()) === trafficBefore.lines,
        usersUnchanged: (await prisma.user.count()) === trafficBefore.users,
        paidUnchanged:
          (await prisma.order.count({ where: { paymentStatus: 'PAID' } })) ===
          trafficBefore.paid,
        productsUnchanged:
          JSON.stringify(
            await prisma.product.findMany({
              select: { id: true, status: true, isArchived: true },
              orderBy: { id: 'asc' },
            }),
          ) === JSON.stringify(trafficBefore.products),
        sessions: await prisma.authSession.count(),
        revoked: await prisma.authSession.count({
          where: { revokedAt: { not: null } },
        }),
      });
      soakResult.setupLogs = soakSetupLogs;
      soakResult.databaseLogOffset = soakDatabaseLogOffset;
    }
    const report = {
      soak: soakResult,
      trafficSpike,
      orderErrors: isOrderBurst ? orderErrors : undefined,
      orderBurst,
      pass: soak
        ? soakResult.pass
        : isTrafficSpike
          ? trafficSpike.pass
          : isOrderBurst
            ? orderBurst.pass
            : menuSpike
              ? menuSpike.pass
              : loginFlood
                ? loginFlood.pass
                : ramp
                  ? ramp.pass
                  : true,
      menuSpike,
      loginFlood,
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
      orderTransactions?.restore();
      const cleanup = await Promise.allSettled([
        privateResultsFile
          ? unlink(privateResultsFile).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
            })
          : Promise.resolve(),
        credentialsFile ? unlink(credentialsFile) : Promise.resolve(),
        app ? app.close() : Promise.resolve(),
        prisma.$disconnect(),
        db.end(),
      ]);
      globalThis.fetch = nativeFetch;
      logCapture?.restore();
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
