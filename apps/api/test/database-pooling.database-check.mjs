// Real PG pool/Prisma/HTTP behavior, restricted to the disposable local runner.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { Controller, Get, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { databaseTimeoutKind } from '../dist/database/database-timeout-error.js';

const url = process.env.DATABASE_URL;
assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    url &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname),
  'Run test:pooling:postgres; hosted targets are refused.',
);
Object.assign(process.env, {
  DB_POOL_MAX: '2',
  DB_POOL_MAX_WAITING: '1',
  DB_POOL_IDLE_TIMEOUT_MS: '5000',
  DB_POOL_MAX_LIFETIME_SECONDS: '30',
  DB_POOL_MAX_PROCESSES: '2',
  DB_POOL_CONNECTION_BUDGET: '4',
  DB_CONNECTION_TIMEOUT_MS: '300',
  DIRECT_DATABASE_URL: 'postgresql://fixture:unused@127.0.0.1:1/not-runtime',
});
const primary = new PrismaService(),
  replica = new PrismaService();
const setup = new pg.Client({
  connectionString: url,
  application_name: 'pool-fixture-monitor',
});
const holds = [];
const results = [];
const instances = [primary, replica];
let app;
const until = async (predicate) => {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error('Pool fixture did not settle');
    await delay(5);
  }
};
const check = async (name, work) => {
  const started = performance.now();
  await work();
  results.push({
    name,
    pass: true,
    elapsedMs: Math.round(performance.now() - started),
  });
};
function hold(db) {
  let release, entered, failed;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve, reject) => {
    entered = resolve;
    failed = reject;
  });
  const work = db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    entered(row.pid);
    await gate;
    return tx.$queryRaw`SELECT 1 AS value`;
  });
  void work.catch(failed);
  const job = { release, ready, work };
  holds.push(job);
  return job;
}
async function releaseAll() {
  holds.forEach((job) => job.release());
  await Promise.allSettled(holds.splice(0).map((job) => job.work));
}
const serverConnections = async () =>
  Number(
    (
      await setup.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'paserve-api'",
      )
    ).rows[0].count,
  );

class PoolFixtureController {
  constructor(prisma) {
    this.prisma = prisma;
  }
  async query(shop) {
    assert.ok(['shop-a', 'shop-b'].includes(shop));
    return this.prisma
      .$queryRaw`SELECT value FROM pooling_fixture WHERE shop_id = ${shop}`;
  }
}
Controller('pool-fixture')(PoolFixtureController);
Reflect.defineMetadata(
  'design:paramtypes',
  [PrismaService],
  PoolFixtureController,
);
Get(':shop')(
  PoolFixtureController.prototype,
  'query',
  Object.getOwnPropertyDescriptor(PoolFixtureController.prototype, 'query'),
);
Param('shop')(PoolFixtureController.prototype, 'query', 0);

await setup.connect();
try {
  await setup.query(
    "CREATE TABLE pooling_fixture (shop_id text PRIMARY KEY, value integer NOT NULL); INSERT INTO pooling_fixture VALUES ('shop-a',10),('shop-b',20)",
  );
  await check(
    'lazy-client-creates-no-idle-connection-before-first-query',
    async () => {
      assert.equal(primary.databasePoolSnapshot().state, 'not-created');
      assert.equal(await serverConnections(), 0);
    },
  );
  await check('cold-concurrent-queries-create-one-bounded-pool', async () => {
    const cold = new PrismaService();
    instances.push(cold);
    try {
      const replies = await Promise.allSettled(
        Array.from(
          { length: 8 },
          () =>
            cold.$queryRaw`SELECT value FROM pooling_fixture, pg_sleep(0.05) WHERE shop_id = 'shop-a'`,
        ),
      );
      assert.ok(replies.some((reply) => reply.status === 'fulfilled'));
      for (const reply of replies) {
        if (reply.status === 'fulfilled')
          assert.equal(reply.value[0].value, 10);
        else assert.equal(databaseTimeoutKind(reply.reason), 'busy');
      }
      assert.equal(cold.databasePoolSnapshot().generations, 1);
      assert.ok(cold.databasePoolSnapshot().peakTotal <= 2);
      assert.ok(cold.databasePoolSnapshot().peakWaiting <= 1);
    } finally {
      await cold.$disconnect();
    }
    assert.equal(await serverConnections(), 0);
  });
  await check(
    'sequential-tenant-queries-reuse-one-connection-and-preserve-scope',
    async () => {
      const pids = new Set();
      for (let index = 0; index < 20; index++) {
        const shop = index % 2 ? 'shop-a' : 'shop-b';
        const [row] =
          await primary.$queryRaw`SELECT pg_backend_pid() AS pid, value FROM pooling_fixture WHERE shop_id = ${shop}`;
        assert.equal(row.value, shop === 'shop-a' ? 10 : 20);
        pids.add(row.pid);
      }
      assert.equal(pids.size, 1);
      assert.equal(primary.databasePoolSnapshot().generations, 1);
      assert.equal(primary.databasePoolSnapshot().total, 1);
    },
  );
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PoolFixtureController],
  })
    .overrideProvider(PrismaService)
    .useValue(primary)
    .compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  assert.equal(app.get(PrismaService), primary);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const get = async (path) => {
    const reply = await fetch(base + path, {
      signal: AbortSignal.timeout(3000),
    });
    return {
      status: reply.status,
      body: await reply.json(),
      retry: reply.headers.get('Retry-After'),
      cache: reply.headers.get('Cache-Control'),
    };
  };
  await check(
    'HTTP-requests-share-the-singleton-pool-across-tenants',
    async () => {
      for (let index = 0; index < 10; index++) {
        const shop = index % 2 ? 'shop-a' : 'shop-b';
        const reply = await get(`/pool-fixture/${shop}`);
        assert.equal(reply.status, 200);
        assert.equal(reply.body[0].value, shop === 'shop-a' ? 10 : 20);
      }
      assert.equal(primary.databasePoolSnapshot().generations, 1);
      assert.ok(primary.databasePoolSnapshot().total <= 2);
    },
  );
  await check(
    'saturated-pool-bounds-connections-and-waiters-with-retryable-HTTP-503',
    async () => {
      const jobs = [hold(primary), hold(primary)];
      await Promise.all(jobs.map((job) => job.ready));
      const rejected = primary.databasePoolSnapshot().rejected;
      const queued = get('/pool-fixture/shop-a');
      await until(() => primary.databasePoolSnapshot().waiting === 1);
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => get('/pool-fixture/shop-b')),
      );
      for (const reply of replies) {
        assert.equal(reply.status, 503);
        assert.equal(reply.body.code, 'DATABASE_BUSY');
        assert.equal(reply.retry, '1');
        assert.equal(reply.cache, 'no-store');
      }
      assert.ok(primary.databasePoolSnapshot().rejected - rejected >= 8);
      const timeout = await queued;
      assert.equal(timeout.status, 503);
      assert.equal(timeout.body.code, 'DATABASE_BUSY');
      assert.ok(primary.databasePoolSnapshot().acquisitionFailures >= 1);
      assert.equal(primary.databasePoolSnapshot().peakWaiting, 1);
      assert.equal(primary.databasePoolSnapshot().peakTotal, 2);
      assert.equal(await serverConnections(), 2);
      assert.equal((await get('/health/live')).status, 200);
      await releaseAll();
      assert.equal((await get('/pool-fixture/shop-a')).status, 200);
      assert.equal((await get('/health')).status, 200);
      assert.equal(primary.databasePoolSnapshot().waiting, 0);
    },
  );
  await check(
    'SQL-errors-and-transaction-rollback-return-their-checkouts',
    async () => {
      await assert.rejects(
        primary.$queryRaw`SELECT fixture_missing_column FROM pooling_fixture`,
      );
      await assert.rejects(
        primary.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 AS value`;
          throw new Error('Fixture rollback');
        }),
        /Fixture rollback/,
      );
      assert.equal((await primary.$queryRaw`SELECT 1 AS value`)[0].value, 1);
      await until(
        () =>
          primary.databasePoolSnapshot().total ===
          primary.databasePoolSnapshot().idle,
      );
      assert.equal(primary.databasePoolSnapshot().waiting, 0);
    },
  );
  await check(
    'idle-backend-failure-is-observed-and-pool-recovers',
    async () => {
      const [row] = await primary.$queryRaw`SELECT pg_backend_pid() AS pid`;
      const before = primary.databasePoolSnapshot().idleErrors;
      await setup.query('SELECT pg_terminate_backend($1)', [row.pid]);
      await until(() => primary.databasePoolSnapshot().idleErrors > before);
      assert.equal((await primary.$queryRaw`SELECT 1 AS value`)[0].value, 1);
      assert.ok(primary.databasePoolSnapshot().total <= 2);
    },
  );
  await check(
    'two-client-pools-stay-within-the-declared-combined-budget',
    async () => {
      const jobs = [hold(primary), hold(primary), hold(replica), hold(replica)];
      await Promise.all(jobs.map((job) => job.ready));
      assert.equal(await serverConnections(), 4);
      assert.equal(primary.databasePoolSnapshot().total, 2);
      assert.equal(replica.databasePoolSnapshot().total, 2);
      await releaseAll();
    },
  );
  await check(
    'disconnect-closes-owned-pool-and-reconnect-keeps-queue-bounds',
    async () => {
      await replica.$disconnect();
      assert.equal(replica.databasePoolSnapshot().state, 'closed');
      const before = primary.databasePoolSnapshot().generations;
      await primary.$disconnect();
      assert.equal(await serverConnections(), 0);
      assert.equal((await primary.$queryRaw`SELECT 1 AS value`)[0].value, 1);
      assert.equal(primary.databasePoolSnapshot().generations, before + 1);
      const jobs = [hold(primary), hold(primary)];
      await Promise.all(jobs.map((job) => job.ready));
      const waiting = primary.$queryRaw`SELECT 1 AS value`;
      const outcome = waiting.catch((error) => error);
      await until(() => primary.databasePoolSnapshot().waiting === 1);
      await assert.rejects(
        primary.$queryRaw`SELECT 1 AS value`,
        (error) => databaseTimeoutKind(error) === 'busy',
      );
      assert.equal(databaseTimeoutKind(await outcome), 'busy');
      await releaseAll();
    },
  );
  await check(
    'application-shutdown-disposes-all-owned-connections',
    async () => {
      await app.close();
      app = undefined;
      assert.equal(primary.databasePoolSnapshot().state, 'closed');
      assert.equal(await serverConnections(), 0);
    },
  );
  Object.assign(process.env, {
    DB_POOL_MAX: '1',
    DB_POOL_MAX_WAITING: '0',
    DB_POOL_IDLE_TIMEOUT_MS: '100',
  });
  const idle = new PrismaService();
  instances.push(idle);
  await check(
    'idle-connections-are-reaped-without-a-minimum-prewarm',
    async () => {
      await idle.$queryRaw`SELECT 1 AS value`;
      await until(() => idle.databasePoolSnapshot().total === 0);
      assert.equal(idle.databasePoolSnapshot().state, 'open');
    },
  );
  await check(
    'zero-waiting-policy-sheds-busy-checkouts-and-recovers',
    async () => {
      const job = hold(idle);
      await job.ready;
      const start = performance.now();
      await assert.rejects(
        idle.$queryRaw`SELECT 1 AS value`,
        (error) => databaseTimeoutKind(error) === 'busy',
      );
      assert.ok(performance.now() - start < 250);
      assert.equal(idle.databasePoolSnapshot().waiting, 0);
      await releaseAll();
      await idle.$disconnect();
    },
  );
  Object.assign(process.env, {
    DB_POOL_IDLE_TIMEOUT_MS: '5000',
    DB_POOL_MAX_LIFETIME_SECONDS: '1',
  });
  const lifetime = new PrismaService();
  instances.push(lifetime);
  await check(
    'lifetime-expiry-does-not-kill-an-in-use-transaction',
    async () => {
      const pid = await lifetime.$transaction(async (tx) => {
        const [before] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await delay(1200);
        const [after] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        assert.equal(after.pid, before.pid);
        return before.pid;
      });
      const [next] = await lifetime.$queryRaw`SELECT pg_backend_pid() AS pid`;
      assert.notEqual(next.pid, pid);
      assert.equal(lifetime.databasePoolSnapshot().peakTotal, 1);
    },
  );
} finally {
  await releaseAll();
  if (app) await app.close();
  await Promise.all(instances.map((db) => db.$disconnect()));
  const remaining = await serverConnections();
  for (const db of instances) {
    const timing = db.databasePoolSnapshot().acquisitionTiming;
    assert.equal(
      timing.buckets.reduce((total, count) => total + count, 0),
      timing.count,
    );
    assert.ok(timing.count > 0 && timing.totalMs >= timing.maxMs);
    const copy = db.databasePoolSnapshot().acquisitionTiming;
    copy.buckets[0] = -1;
    assert.ok(db.databasePoolSnapshot().acquisitionTiming.buckets[0] >= 0);
  }
  await setup.end();
  const report = {
    pass: results.length === 13 && remaining === 0,
    scope: 'disposable-postgres-real-prisma-pools-and-http',
    remainingApplicationConnections: remaining,
    pools: instances.map((db) => db.databasePoolSnapshot()),
    checks: results,
  };
  if (process.env.TIMEOUT_DB_REPORT) {
    await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
    await writeFile(
      process.env.TIMEOUT_DB_REPORT,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  assert.equal(remaining, 0);
}
assert.equal(results.length, 13);
console.log(
  `PASS: ${results.length} real PostgreSQL connection-pooling checks; no hosted database contacted.`,
);
