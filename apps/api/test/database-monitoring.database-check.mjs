import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseMonitor } from '../scripts/database-monitor.mjs';
import { PrismaService } from '../dist/database/prisma.service.js';
import { RequestWork } from '../dist/common/load-shedding/request-work.js';

const connectionString = process.env.DATABASE_URL;
assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    new URL(connectionString).hostname === '127.0.0.1',
  'Use the owned local monitoring runner',
);
const clients = [];
async function client(extra = {}) {
  const connection = new pg.Client({
    connectionString,
    statement_timeout: 5000,
    ...extra,
  });
  await connection.connect();
  clients.push(connection);
  return connection;
}
const checks = [],
  snapshots = [];
let prisma;
async function check(name, work) {
  await work();
  checks.push({ name, pass: true });
}
try {
  const setup = await client(),
    observer = await client({ options: '-c default_transaction_read_only=on' });
  const holder = await client(),
    waiter = await client();
  const monitor = new DatabaseMonitor(observer);
  await setup.query(
    'CREATE TABLE monitor_fixture (id int PRIMARY KEY, value int); INSERT INTO monitor_fixture VALUES(1,0)',
  );
  await check(
    'baseline-is-read-only-and-separates-client-backends',
    async () => {
      const sample = await monitor.sample();
      snapshots.push(sample);
      assert.equal(sample.interval.status, 'baseline');
      assert.equal(sample.database.fullVisibility, true);
      assert.ok(sample.database.clientConnections >= 3);
      assert.ok(sample.database.serverClientConnections >= 4);
      await assert.rejects(
        () => observer.query('UPDATE monitor_fixture SET value=1'),
        { code: '25006' },
      );
      assert.equal(
        (await monitor.statements()).reason,
        'extension-not-installed',
      );
    },
  );
  await check('detects-a-slow-query-without-logging-its-text', async () => {
    const slow = waiter.query('SELECT pg_sleep(1.6)');
    await delay(1150);
    const sample = await monitor.sample();
    snapshots.push(sample);
    assert.ok(sample.signals.includes('slow-active-queries'));
    assert.ok(sample.database.oldestActiveMs >= 1000);
    assert.ok(!JSON.stringify(sample).includes('pg_sleep'));
    await slow;
  });
  await check(
    'detects-lock-waits-and-idle-transactions-and-recovers',
    async () => {
      await holder.query(
        'BEGIN; UPDATE monitor_fixture SET value=value+1 WHERE id=1',
      );
      const blocked = waiter.query(
        'UPDATE monitor_fixture SET value=value+1 WHERE id=1',
      );
      // Wait for PostgreSQL to register the lock, rather than relying on one timer.
      let sample;
      for (let attempt = 0; attempt < 40; attempt++) {
        await delay(20);
        sample = await monitor.sample();
        if (sample.database.lockWaiters) break;
      }
      snapshots.push(sample);
      assert.ok(sample.signals.includes('lock-contention'));
      assert.ok(sample.signals.includes('idle-transaction'));
      await holder.query('ROLLBACK');
      await blocked;
      const recovery = await monitor.sample();
      snapshots.push(recovery);
      assert.equal(recovery.database.lockWaiters, 0);
      assert.equal(recovery.database.idleInTransaction, 0);
    },
  );
  await check(
    'supports-extension-schema-and-bounded-aggregate-statement-statistics',
    async () => {
      await setup.query(
        'CREATE SCHEMA extensions; CREATE EXTENSION pg_stat_statements SCHEMA extensions',
      );
      await setup.query('SELECT count(*) FROM monitor_fixture');
      const statements = await monitor.statements();
      snapshots.push({ statements });
      assert.equal(statements.status, 'available');
      assert.ok(statements.rows.length > 0 && statements.rows.length <= 10);
      assert.ok(
        statements.rows.every((row) => !('query' in row) && row.calls > 0),
      );
    },
  );
  await check('restricted-role-reports-incomplete-visibility', async () => {
    await setup.query('CREATE ROLE monitor_limited');
    await observer.query('SET ROLE monitor_limited');
    const sample = await monitor.sample();
    snapshots.push(sample);
    assert.equal(sample.database.fullVisibility, false);
    assert.ok(sample.signals.includes('incomplete-visibility'));
    await observer.query('RESET ROLE');
  });
  await check('measures-real-table-and-index-growth', async () => {
    await setup.query(
      'CREATE TABLE monitor_growth (id int PRIMARY KEY, payload text)',
    );
    const before = await monitor.relations();
    assert.equal(before.status, 'available');
    await setup.query(
      'INSERT INTO monitor_growth SELECT g,repeat(md5(g::text),20) FROM generate_series(1,3000) g',
    );
    const after = await monitor.relations();
    snapshots.push({ relations: after });
    assert.equal(after.growth.status, 'compared');
    const table = after.growth.changes.find(
      (row) => row.name === 'monitor_growth',
    );
    const index = after.growth.changes.find(
      (row) => row.name === 'monitor_growth_pkey',
    );
    assert.ok(table.bytesDelta > 0 && table.indexBytesDelta > 0);
    assert.ok(index.bytesDelta > 0);
  });
  await check(
    'separates-concurrent-analytics-and-order-query-durations-in-real-prisma-transactions',
    async () => {
      prisma = new PrismaService();
      const analytics = new RequestWork(
        () => {},
        'expensive',
        false,
        'analytics',
      );
      const orders = new RequestWork(() => {}, 'general', false, 'orders');
      await Promise.all([
        analytics.run(() =>
          prisma.$transaction(async (tx) => {
            // A real aggregate plus a deliberately expensive fixture query.
            await tx.$queryRawUnsafe('SELECT count(*) FROM monitor_growth');
            await tx.$queryRawUnsafe('SELECT 1 FROM pg_sleep(0.3)');
          }),
        ),
        orders.run(() =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              'UPDATE monitor_fixture SET value=value+1 WHERE id=1',
            );
            await tx.$queryRawUnsafe(
              'SELECT value FROM monitor_fixture WHERE id=1',
            );
          }),
        ),
      ]);
      await assert.rejects(() =>
        analytics.run(() =>
          prisma.$queryRawUnsafe(
            'SELECT nonexistent_column FROM monitor_fixture',
          ),
        ),
      );
      const groups = prisma.databasePoolSnapshot().queryWorkloads;
      snapshots.push({ queryWorkloads: groups });
      // Transaction COMMIT may itself use executeRaw; never assume an exact count.
      assert.ok(
        groups.analytics.count >= 3 &&
          groups.analytics.failures === 1 &&
          groups.analytics.slow >= 1,
      );
      assert.ok(groups.orders.count >= 2 && groups.orders.failures === 0);
      for (const group of Object.values(groups))
        assert.equal(
          group.buckets.reduce((sum, value) => sum + value, 0),
          group.count,
        );
      analytics.close();
      orders.close();
      await prisma.$disconnect();
      assert.equal(prisma.databasePoolSnapshot().total, 0);
    },
  );
  await check(
    'operator-cli-emits-bounded-json-and-redacts-connection-failures',
    async () => {
      const execute = promisify(execFile);
      const script = fileURLToPath(
        new URL('../scripts/database-monitor.mjs', import.meta.url),
      );
      const options = {
        windowsHide: true,
        timeout: 10_000,
        env: {
          ...process.env,
          MONITOR_DATABASE_URL: connectionString,
          DB_MONITOR_SAMPLES: '2',
          DB_MONITOR_INTERVAL_MS: '1000',
        },
      };
      const result = await execute(process.execPath, [script], options);
      const samples = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(samples.length, 2);
      assert.ok(samples.every((sample) => sample.type === 'database-monitor'));
      assert.equal(samples[1].interval.status, 'ok');
      assert.equal(samples[0].relations.growth.status, 'baseline');
      assert.equal(samples[1].relations.growth.status, 'compared');
      assert.ok(!result.stdout.includes(connectionString));
      await assert.rejects(
        () =>
          execute(process.execPath, [script], {
            ...options,
            env: {
              ...options.env,
              MONITOR_DATABASE_URL:
                'postgresql://private:secret@127.0.0.1:1/db',
            },
          }),
        (error) =>
          error.stderr.trim() ===
          'Database monitor failed. Check configuration, connectivity and monitoring permissions.',
      );
    },
  );
} finally {
  await prisma?.$disconnect();
  // Roll back first so failed assertions cannot leave waiter shutdown hanging.
  for (const connection of clients) {
    // A bounded query timeout also protects failure cleanup.
    try {
      await connection.query('ROLLBACK');
    } catch {
      /* connection may already be closed */
    }
  }
  await Promise.allSettled(clients.map((connection) => connection.end()));
  const report = {
    pass: checks.length === 8,
    scope: 'owned-disposable-postgresql',
    checks,
    snapshots,
  };
  await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
  await writeFile(
    process.env.TIMEOUT_DB_REPORT,
    JSON.stringify(report, null, 2) + '\n',
  );
}
assert.equal(checks.length, 8);
console.log(
  'PASS: 8 real PostgreSQL monitoring scenarios; no hosted database used.',
);
