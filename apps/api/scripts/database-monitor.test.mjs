import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DatabaseMonitor,
  databaseInterval,
  databaseSignals,
  databaseSampleSql,
  monitorOptions,
  relationGrowth,
  relationSizeSql,
} from './database-monitor.mjs';

test('relation growth handles signed changes, creations, removals and rewrites', () => {
  const row = (relationId, bytes, generation = '1') => ({
    relationId,
    bytes,
    generation,
    schema: 'public',
    name: 'fixture',
    kind: 'table',
    indexBytes: 100,
  });
  assert.equal(relationGrowth(null, []).status, 'baseline');
  const result = relationGrowth(
    [row('1', 100), row('2', 200), row('3', 300), row('4', 100)],
    [row('1', 150), row('2', 20), row('3', 100, '2'), row('5', 10)],
  );
  assert.deepEqual(
    result.changes.map((entry) => [entry.status, entry.bytesDelta]),
    [
      ['existing', 50],
      ['existing', -180],
      ['rewritten', null],
      ['created', null],
      ['removed', null],
    ],
  );
});

test('incomplete relation catalogs discard the baseline and never invent removals', async () => {
  let rows = [{ relationId: '1', generation: '1', bytes: 1, indexBytes: 0 }];
  const monitor = new DatabaseMonitor({
    query: async (sql) => {
      assert.equal(sql, relationSizeSql);
      return { rows };
    },
  });
  assert.equal((await monitor.relations()).growth.status, 'baseline');
  rows = Array(601).fill(rows[0]);
  assert.equal((await monitor.relations()).status, 'incomplete');
  rows = [];
  assert.equal((await monitor.relations()).growth.status, 'baseline');
});

test('relation permission loss is explicit, and connectivity errors propagate', async () => {
  let code = '42501';
  const monitor = new DatabaseMonitor({
    query: async () => {
      throw Object.assign(new Error('private'), { code });
    },
  });
  assert.equal((await monitor.relations()).status, 'unavailable');
  code = '08006';
  await assert.rejects(() => monitor.relations(), { code });
});

const baseline = () => ({
  sampledAt: new Date(1000),
  statsReset: null,
  commits: 1,
  rollbacks: 0,
  deadlocks: 0,
  tempBytes: 0,
  blocksHit: 90,
  blocksRead: 10,
  blockReadMs: 0,
  blockWriteMs: 0,
  fullVisibility: true,
  activitiesTracked: true,
  countsTracked: true,
  serverClientConnections: 2,
  serverMaxConnections: 10,
  lockWaiters: 0,
  ioWaiters: 0,
  slowActiveQueries: 0,
  oldestTransactionMs: 0,
  idleInTransaction: 0,
});

test('intervals are baseline/reset aware and report no invented empty cache ratio', () => {
  const first = baseline(),
    next = {
      ...first,
      sampledAt: new Date(2000),
      commits: 3,
      blocksHit: 180,
      blocksRead: 20,
    };
  assert.equal(databaseInterval(null, first).status, 'baseline');
  const interval = databaseInterval(first, next);
  assert.equal(interval.transactionsPerSecond, 2);
  assert.equal(interval.bufferHitRatio, 0.9);
  assert.equal(
    databaseInterval(first, { ...next, statsReset: new Date() }).status,
    'reset',
  );
  assert.equal(
    databaseInterval(first, { ...next, commits: 0 }).status,
    'reset',
  );
  assert.equal(databaseInterval(first, first).status, 'invalid-time');
  assert.equal(
    databaseInterval(first, { ...first, sampledAt: new Date(2000) })
      .bufferHitRatio,
    null,
  );
});

test('signals distinguish missing visibility, locks, I/O, connections and transactions', () => {
  assert.deepEqual(databaseSignals(baseline(), { status: 'baseline' }), []);
  assert.deepEqual(
    databaseSignals(
      {
        ...baseline(),
        fullVisibility: false,
        serverClientConnections: 8,
        lockWaiters: 1,
        ioWaiters: 1,
        slowActiveQueries: 1,
        oldestTransactionMs: 30000,
        idleInTransaction: 1,
      },
      { status: 'reset', delta: { deadlocks: 1, tempBytes: 20 * 1024 * 1024 } },
    ),
    [
      'incomplete-visibility',
      'connection-pressure',
      'lock-contention',
      'io-waits',
      'slow-active-queries',
      'long-transaction',
      'idle-transaction',
      'deadlocks-in-interval',
      'temporary-file-growth',
      'statistics-reset',
    ],
  );
});

test('monitor requires an explicit credential and strictly bounded duration', () => {
  assert.throws(() => monitorOptions({ DATABASE_URL: 'postgres://ignored' }));
  for (const value of ['0', '-1', '1.5', '721', 'Infinity', ''])
    assert.throws(() =>
      monitorOptions({
        MONITOR_DATABASE_URL: 'postgres://localhost/db',
        DB_MONITOR_SAMPLES: value,
      }),
    );
  assert.throws(() =>
    monitorOptions({ MONITOR_DATABASE_URL: 'https://localhost' }),
  );
  assert.throws(() =>
    monitorOptions({
      MONITOR_DATABASE_URL: 'postgres://localhost/db',
      DB_MONITOR_INTERVAL_MS: '999',
    }),
  );
  assert.equal(
    monitorOptions({ MONITOR_DATABASE_URL: 'postgres://localhost/db' }).samples,
    12,
  );
});

test('sampling retains only the previous aggregate and fixed statement limit', async () => {
  let index = 0;
  const monitor = new DatabaseMonitor({
    query: async (sql) => {
      assert.equal(sql, databaseSampleSql);
      return {
        rows: [{ ...baseline(), sampledAt: new Date(1000 + index++ * 1000) }],
      };
    },
  });
  assert.equal((await monitor.sample()).interval.status, 'baseline');
  assert.equal((await monitor.sample()).interval.status, 'ok');
  assert.equal(Object.keys(monitor).length, 2);
});

test('extension absence is explicit; never creates or resets statistics', async () => {
  const monitor = new DatabaseMonitor({ query: async () => ({ rows: [] }) });
  assert.deepEqual(await monitor.statements(), {
    status: 'unavailable',
    reason: 'extension-not-installed',
  });
});

test('extension schema is escaped, bounded and excludes SQL text and identities', async () => {
  const queries = [];
  const monitor = new DatabaseMonitor({
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: queries.length === 1 ? [{ nspname: 'extension"schema' }] : [],
      };
    },
  });
  assert.equal((await monitor.statements()).status, 'available');
  assert.match(queries[1], /FROM "extension""schema".pg_stat_statements/);
  assert.match(queries[1], /LIMIT 10/);
  assert.doesNotMatch(queries[1], /\bquery\b|\buserid\b|\bCREATE\b|\bRESET\b/i);
});

for (const code of ['42501', '55000', '42P01', '42703', '08006', '57014']) {
  test(`statement capability handles ${code} without swallowing network/timeouts`, async () => {
    let count = 0;
    const error = Object.assign(new Error('sensitive-detail'), { code });
    const monitor = new DatabaseMonitor({
      query: async () => {
        if (++count === 1) return { rows: [{ nspname: 'public' }] };
        throw error;
      },
    });
    if (['08006', '57014'].includes(code))
      await assert.rejects(() => monitor.statements(), error);
    else {
      const report = await monitor.statements();
      assert.equal(report.status, 'unavailable');
      assert.ok(!JSON.stringify(report).includes('sensitive-detail'));
    }
  });
}
