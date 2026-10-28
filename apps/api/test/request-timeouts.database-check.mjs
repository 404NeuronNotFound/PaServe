// Session/read-only SQL probes, restricted to the disposable local runner's target.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { databaseTimeouts } from '../dist/database/database-timeouts.js';
import { databaseTimeoutKind } from '../dist/database/database-timeout-error.js';
import { PrismaService } from '../dist/database/prisma.service.js';

const url = process.env.DATABASE_URL;
assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    url &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
  'Use test:timeouts:postgres to start an isolated local cluster; remote/configured app targets are refused.',
);
const results = [];
async function check(name, work) {
  const start = performance.now();
  await work();
  results.push({
    name,
    pass: true,
    elapsedMs: Math.round(performance.now() - start),
  });
}
const defaults = databaseTimeouts({});
const names = [
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
];
for (const [key, value] of Object.entries({
  DB_STATEMENT_TIMEOUT_MS: 10000,
  DB_LOCK_TIMEOUT_MS: 3000,
  DB_IDLE_TRANSACTION_TIMEOUT_MS: 15000,
  DB_CONNECTION_TIMEOUT_MS: 3000,
  DB_TRANSACTION_MAX_WAIT_MS: 3000,
  DB_TRANSACTION_TIMEOUT_MS: 30000,
}))
  process.env[key] = String(value);
const normal = new PrismaService();
let serverVersion;
try {
  await check(
    'production-default-adapter-settings-reach-postgres',
    async () => {
      const settings =
        await normal.$queryRaw`SELECT name, setting FROM pg_settings
      WHERE name IN ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout')`;
      for (const name of names)
        assert.equal(
          Number(settings.find((entry) => entry.name === name).setting),
          defaults.pool[name],
        );
      serverVersion = (await normal.$queryRaw`SHOW server_version`)[0]
        .server_version;
    },
  );
} finally {
  await normal.$disconnect();
}

process.env.DB_STATEMENT_TIMEOUT_MS = '250';
process.env.DB_LOCK_TIMEOUT_MS = '100';
process.env.DB_CONNECTION_TIMEOUT_MS = '1000';
process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS = '300';
process.env.DB_TRANSACTION_TIMEOUT_MS = '400';
const policy = databaseTimeouts(process.env);
const pool = new pg.Pool({ connectionString: url, ...policy.pool, max: 1 });
const prisma = new PrismaService();
const client = () => new pg.Client({ connectionString: url, ...policy.pool });
try {
  await check('statement-is-cancelled-and-connection-recovers', async () => {
    await assert.rejects(
      pool.query('SELECT pg_sleep(2)'),
      (error) => error.code === '57014',
    );
    assert.equal((await pool.query('SELECT 1 AS value')).rows[0].value, 1);
    const activity = await pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query = 'SELECT pg_sleep(2)'",
    );
    assert.equal(activity.rows[0].count, 0);
  });
  await check('pool-checkout-wait-is-bounded', async () => {
    const held = await pool.connect();
    try {
      await assert.rejects(pool.connect(), /timeout/i);
    } finally {
      held.release();
    }
    assert.equal((await pool.query('SELECT 1 AS value')).rows[0].value, 1);
  });
  await check('lock-contention-is-cancelled-and-recovers', async () => {
    const holder = client(),
      contender = client();
    await holder.connect();
    try {
      await contender.connect();
      await holder.query('SELECT pg_advisory_lock(74210, 271)');
      await assert.rejects(
        contender.query('SELECT pg_advisory_lock(74210, 271)'),
        (error) => error.code === '55P03',
      );
      assert.equal(
        (await contender.query('SELECT 1 AS value')).rows[0].value,
        1,
      );
    } finally {
      await holder.query('SELECT pg_advisory_unlock_all()');
      await Promise.all([holder.end(), contender.end()]);
    }
  });
  await check('idle-transaction-session-is-terminated', async () => {
    const idle = client();
    const terminated = new Promise((resolve) => idle.once('error', resolve));
    await idle.connect();
    await idle.query('BEGIN');
    const error = await terminated;
    assert.equal(error.code, '25P03');
    await idle.end();
  });
  await check(
    'cancelled-transaction-rolls-back-and-session-recovers',
    async () => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await assert.rejects(
          connection.query('SELECT pg_sleep(2)'),
          (error) => error.code === '57014',
        );
        await assert.rejects(
          connection.query('SELECT 1'),
          (error) => error.code === '25P02',
        );
        await connection.query('ROLLBACK');
        assert.equal(
          (await connection.query('SELECT 1 AS value')).rows[0].value,
          1,
        );
      } finally {
        connection.release();
      }
    },
  );
  await check(
    'prisma-statement-timeout-is-classified-and-recovers',
    async () => {
      let captured;
      try {
        await prisma.$queryRaw`SELECT pg_sleep(2)`;
      } catch (error) {
        captured = error;
      }
      assert.equal(databaseTimeoutKind(captured), 'deadline');
      assert.equal((await prisma.$queryRaw`SELECT 1 AS value`)[0].value, 1);
    },
  );
  await check(
    'prisma-interactive-transaction-lifetime-is-bounded',
    async () => {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          for (let count = 0; count < 10; count++)
            await tx.$queryRaw`SELECT 1 AS value FROM pg_sleep(0.1)`;
        }),
        (error) => error.code === 'P2028',
      );
      assert.equal((await prisma.$queryRaw`SELECT 1 AS value`)[0].value, 1);
    },
  );
} finally {
  await prisma.$disconnect();
  await pool.end();
  const report = {
    pass: results.length === 8,
    serverVersion,
    scope: 'disposable-loopback-postgres-no-application-data',
    productionDefaults: defaults,
    acceleratedPolicy: policy,
    checks: results,
  };
  if (process.env.TIMEOUT_DB_REPORT) {
    await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
    await writeFile(
      process.env.TIMEOUT_DB_REPORT,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
assert.equal(results.length, 8);
console.log(
  `PASS: ${results.length} real PostgreSQL timeout/recovery checks on ${serverVersion}; disposable local database, no application data modified.`,
);
