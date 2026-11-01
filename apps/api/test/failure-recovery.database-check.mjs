// Only the runner's owned disposable PostgreSQL. No application env file/target.
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import { Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ApiCapacityService } from '../dist/common/load-shedding/api-capacity.service.js';
import { recoveryWorkload } from './recovery-workload.mjs';

const target = new URL(process.env.DATABASE_URL);
const startedAt = new Date().toISOString();
let postgresVersion;
let workload;
assert.ok(
  process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
    target.hostname === '127.0.0.1' &&
    target.username === 'timeout_fixture' &&
    process.env.PASERVE_IGNORE_ENV_FILE === 'true',
  'Use the owned recovery runner',
);
const admin = new pg.Client({
  connectionString: target.href,
  connectionTimeoutMillis: 3000,
  statement_timeout: 1000,
  query_timeout: 2000,
});
let reachable = true,
  app;
const sockets = new Set();
const proxy = createServer((socket) => {
  if (!reachable) {
    socket.destroy();
    return;
  }
  const upstream = connect({ host: '127.0.0.1', port: Number(target.port) });
  for (const [source, peer] of [
    [socket, upstream],
    [upstream, socket],
  ]) {
    sockets.add(source);
    source.on('error', () => peer.destroy());
    source.on('close', () => {
      sockets.delete(source);
      peer.destroy();
    });
  }
  socket.pipe(upstream).pipe(socket);
});
const checks = [];
async function check(name, work) {
  const start = performance.now();
  try {
    await work();
  } catch (error) {
    checks.push({
      name,
      pass: false,
      elapsedMs: Math.round(performance.now() - start),
    });
    throw error;
  }
  checks.push({
    name,
    pass: true,
    elapsedMs: Math.round(performance.now() - start),
  });
}
async function until(work) {
  const end = Date.now() + 4000;
  while (!(await work())) {
    assert.ok(Date.now() < end, 'Fixture did not settle');
    await delay(10);
  }
}
class RecoveryProbeController {
  constructor(prisma) {
    this.prisma = prisma;
  }
  async read() {
    return (
      await this.prisma.$queryRawUnsafe(
        'SELECT value FROM recovery_fixture WHERE id=1',
      )
    )[0];
  }
  async locked() {
    return {
      updated: await this.prisma.$executeRawUnsafe(
        'UPDATE recovery_fixture SET value=value+1 WHERE id=1',
      ),
    };
  }
  async slowWrite() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'UPDATE recovery_fixture SET value=value+10 WHERE id=1',
      );
      await tx.$queryRawUnsafe('SELECT 1 FROM pg_sleep(2)');
      return { saved: true };
    });
  }
}
Controller('recovery-fixture')(RecoveryProbeController);
Reflect.defineMetadata(
  'design:paramtypes',
  [PrismaService],
  RecoveryProbeController,
);
for (const [method, decorator] of [
  ['read', Get('read')],
  ['locked', Post('locked')],
  ['slowWrite', Post('slow-write')],
])
  decorator(
    RecoveryProbeController.prototype,
    method,
    Object.getOwnPropertyDescriptor(RecoveryProbeController.prototype, method),
  );

let prisma, origin;
const call = async (path, method = 'GET') => {
  const start = performance.now();
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method,
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  assert.ok(
    !JSON.stringify(body).match(
      /postgresql:|timeout_fixture|SELECT |UPDATE |password/i,
    ),
    'Unsafe error response',
  );
  return {
    status: response.status,
    body,
    retryAfter: response.headers.get('retry-after'),
    elapsedMs: performance.now() - start,
  };
};
try {
  await admin.connect();
  postgresVersion = (await admin.query('SHOW server_version')).rows[0]
    .server_version;
  await admin.query(
    'CREATE TABLE recovery_fixture (id int PRIMARY KEY, value int NOT NULL); INSERT INTO recovery_fixture VALUES(1,1)',
  );
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const runtime = new URL(target);
  runtime.port = String(proxy.address().port);
  Object.assign(process.env, {
    DATABASE_URL: runtime.href,
    DB_POOL_MAX: '2',
    DB_POOL_MAX_WAITING: '1',
    DB_CONNECTION_TIMEOUT_MS: '200',
    DB_STATEMENT_TIMEOUT_MS: '350',
    DB_LOCK_TIMEOUT_MS: '150',
    DB_TRANSACTION_MAX_WAIT_MS: '300',
    DB_TRANSACTION_TIMEOUT_MS: '2000',
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [RecoveryProbeController],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  origin = await app.getUrl();
  const value = async () =>
    (await admin.query('SELECT value FROM recovery_fixture WHERE id=1')).rows[0]
      .value;
  await check('healthy-baseline-and-readiness', async () => {
    assert.equal((await call('recovery-fixture/read')).body.value, 1);
    assert.equal((await call('health')).status, 200);
  });
  await check(
    'statement-timeout-rolls-back-a-partial-write-and-releases-capacity',
    async () => {
      const before = await value(),
        response = await call('recovery-fixture/slow-write', 'POST');
      assert.equal(response.status, 504);
      assert.equal(response.body.code, 'DEPENDENCY_TIMEOUT');
      assert.ok(response.elapsedMs < 2000);
      assert.equal(await value(), before);
      await until(
        () => app.get(ApiCapacityService).snapshot().active.total === 0,
      );
      assert.equal((await call('recovery-fixture/read')).status, 200);
    },
  );
  await check(
    'lock-contention-fails-boundedly-and-recovers-without-restart',
    async () => {
      await admin.query(
        'BEGIN; UPDATE recovery_fixture SET value=value+100 WHERE id=1',
      );
      try {
        const response = await call('recovery-fixture/locked', 'POST');
        assert.equal(response.status, 503);
        assert.equal(response.body.code, 'DATABASE_BUSY');
        assert.equal(response.retryAfter, '1');
        assert.ok(response.elapsedMs < 2000);
      } finally {
        await admin.query('ROLLBACK');
      }
      assert.equal((await call('recovery-fixture/locked', 'POST')).status, 201);
      assert.equal(await value(), 2);
    },
  );
  await check(
    'database-network-outage-keeps-liveness-up-and-readiness-failed',
    async () => {
      reachable = false;
      for (const socket of sockets) socket.destroy();
      await delay(25);
      const response = await call('recovery-fixture/read');
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'DATABASE_BUSY');
      assert.ok(response.elapsedMs < 2000);
      assert.equal((await call('health/live')).status, 200);
      assert.equal((await call('health')).status, 503);
      reachable = true;
      await until(
        async () => (await call('recovery-fixture/read')).status === 200,
      );
      assert.equal((await call('health')).status, 200);
    },
  );
  await check(
    'terminating-only-the-fixture-api-session-rolls-back-and-reconnects',
    async () => {
      const before = await value();
      let entered;
      const ready = new Promise((resolve) => {
        entered = resolve;
      });
      const transaction = prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRawUnsafe(
          'SELECT pg_backend_pid() AS pid',
        );
        await tx.$executeRawUnsafe(
          'UPDATE recovery_fixture SET value=value+10 WHERE id=1',
        );
        entered(row.pid);
        await tx.$queryRawUnsafe('SELECT 1 FROM pg_sleep(2)');
      });
      // Attach failure observation before injecting the fault, avoiding unhandled rejection.
      const outcome = transaction.then(
        () => false,
        () => true,
      );
      const pid = await Promise.race([
        ready,
        outcome.then(() => {
          throw new Error('Fixture transaction ended before fault injection');
        }),
      ]);
      const owned = (
        await admin.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1 AND application_name='paserve-api' AND usename='timeout_fixture'",
          [pid],
        )
      ).rows[0].n;
      assert.equal(owned, 1);
      assert.equal(
        (
          await admin.query('SELECT pg_terminate_backend($1) AS terminated', [
            pid,
          ])
        ).rows[0].terminated,
        true,
      );
      assert.equal(await outcome, true);
      assert.equal(await value(), before);
      assert.equal((await call('recovery-fixture/read')).status, 200);
      await until(
        () => app.get(ApiCapacityService).snapshot().active.total === 0,
      );
    },
  );
  const beforeWorkloadValue = await value();
  workload = await recoveryWorkload({ origin, prisma, admin });
  assert.equal(
    workload.pass,
    true,
    'Measured workload or resource monitoring failed',
  );
  assert.equal(
    await value(),
    beforeWorkloadValue + workload.workflows.write.success,
  );
  await until(() => {
    const pool = prisma.databasePoolSnapshot();
    return (
      pool.total === pool.idle &&
      pool.waiting === 0 &&
      pool.acquired === pool.released
    );
  });
} finally {
  reachable = true;
  await app?.close();
  for (const socket of sockets) socket.destroy();
  if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
  await admin.end();
  // Destroy schedules close events; await both halves before sampling cleanup.
  await until(() => sockets.size === 0);
  const pool = prisma?.databasePoolSnapshot();
  const report = {
    runId: process.env.FAILURE_RECOVERY_RUN_ID ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    postgresVersion,
    profile: {
      statementMs: 350,
      lockMs: 150,
      connectionMs: 200,
      poolMax: 2,
      maxWaiting: 1,
    },
    pass:
      checks.length === 5 &&
      checks.every((check) => check.pass) &&
      workload?.pass === true &&
      pool?.total === 0 &&
      sockets.size === 0,
    workload,
    scope:
      'owned disposable PostgreSQL, real Nest/Prisma and isolated loopback TCP fault proxy',
    checks,
    resources: { pool, remainingProxySockets: sockets.size },
  };
  await mkdir(dirname(process.env.TIMEOUT_DB_REPORT), { recursive: true });
  await writeFile(
    process.env.TIMEOUT_DB_REPORT,
    JSON.stringify(report, null, 2) + '\n',
  );
}
assert.equal(checks.length, 5);
assert.equal(sockets.size, 0);
console.log('PASS: 5 isolated PostgreSQL failure/recovery scenarios.');
