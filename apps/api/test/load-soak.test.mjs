import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soakProfile,
  expectedSoakSessions,
  expectedSoakRefreshes,
} from './load-soak.profile.mjs';
import {
  evaluateSoak,
  analyzeSoakMemory,
  robustSlope,
} from './load-soak.metrics.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';
import { soakLogs, auditSoakDatabaseLog } from './load-soak.logs.mjs';
import { mkdtemp, writeFile, unlink, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const MiB = 1024 * 1024;
function fixture() {
  const p = soakProfile('initial');
  const resource = (phase, elapsedMs, idle = false) => ({
    phase,
    elapsedMs,
    process: {
      rssBytes: 200 * MiB,
      heapUsedBytes: 40 * MiB,
      externalBytes: 5 * MiB,
    },
    api: {
      soakLogs: {
        enabled: true,
        warn: 0,
        error: 0,
        fatal: 0,
        processWarning: 0,
      },
      soakResources: { Timeout: 200, TCPSocketWrap: idle ? 2 : 7 },
      pool: {
        total: idle ? 0 : 5,
        waiting: 0,
        pendingCheckouts: 0,
        acquired: 100,
        released: 100,
        policy: { max: 5, maxWaiting: 20 },
      },
      capacity: { active: { total: 0 } },
      fairness: { activeScopeLeases: 0 },
      menuGate: { active: 0, waiting: 0 },
      passwords: { active: 0 },
    },
    database: {
      connections: idle ? 2 : 7,
      clientConnections: idle ? 2 : 7,
      backgroundConnections: 0,
      activityBackends: idle ? 2 : 7,
    },
    network: { activeConnections: 0 },
  });
  const summaries = Array.from({ length: p.windows + 1 }, (_, i) => ({
    phase: i === 0 ? 'soak-warmup' : `soak-window-${i - 1}`,
    seconds: 60,
    requests: 360,
    successes: 360,
    errorRate: 0,
    missed: 0,
    byKind: Object.fromEntries(
      [
        'menu',
        'product',
        'order-status',
        'dashboard',
        'cashier',
        'kitchen',
        'health',
      ].map((kind) => [
        kind,
        {
          requests: kind === 'health' ? 12 : 60,
          successes: kind === 'health' ? 12 : 60,
          errorRate: 0,
          p95Ms: 50,
          p99Ms: 100,
        },
      ]),
    ),
  }));
  return {
    workload: {
      profile: p,
      complete: true,
      windows: summaries,
      controls: [{ ok: true, ms: 100 }],
      missed: 0,
      peakInFlight: 8,
      refreshes: expectedSoakRefreshes(p),
      sessionsCreated: expectedSoakSessions(p),
      sessionsRevoked: expectedSoakSessions(p),
    },
    monitoring: {
      sampleFailures: 0,
      truncated: false,
      samples: [
        ...Array.from({ length: p.windows }, (_, i) =>
          Array.from({ length: 60 }, (_, j) =>
            resource(`soak-window-${i}`, 100000 + i * 60000 + j * 1000),
          ),
        ).flat(),
        ...Array.from({ length: 31 }, (_, j) =>
          resource('soak-cooldown', 700000 + j * 1000, true),
        ),
      ],
    },
    evidence: {
      logs: { enabled: true, warn: 0, error: 0, fatal: 0, processWarning: 0 },
      ordersUnchanged: true,
      linesUnchanged: true,
      usersUnchanged: true,
      productsUnchanged: true,
      paidUnchanged: true,
      sessions: expectedSoakSessions(p),
      revoked: expectedSoakSessions(p),
    },
  };
}
const evaluate = (f) => evaluateSoak(f.workload, f.monitoring, f.evidence);
await test('accepts covered stable measurements and idle resources after sustained traffic', () =>
  assert.equal(evaluate(fixture()).pass, true));
for (const [label, change] of [
  [
    'missing client connection classification',
    (f) => {
      delete f.monitoring.samples[100].database.clientConnections;
    },
  ],
  [
    'excess client connections',
    (f) => {
      f.monitoring.samples[100].database.clientConnections = 9;
      f.monitoring.samples[100].database.activityBackends = 9;
    },
  ],
  [
    'inconsistent backend classification',
    (f) => {
      f.monitoring.samples[100].database.activityBackends = 10;
    },
  ],
  [
    'missing log capture',
    (f) => {
      delete f.evidence.logs;
    },
  ],
  [
    'accumulating warnings',
    (f) => {
      f.monitoring.samples[100].api.soakLogs.warn++;
    },
  ],
  [
    'runtime error logs',
    (f) => {
      f.evidence.logs.error++;
    },
  ],
  [
    'shortened run',
    (f) => {
      f.workload.windows.pop();
    },
  ],
  [
    'missed scheduled work',
    (f) => {
      f.workload.missed++;
    },
  ],
  [
    'leaked DB checkout',
    (f) => {
      f.monitoring.samples.at(-1).api.pool.released = 99;
    },
  ],
  [
    'connection retained after cooldown',
    (f) => {
      f.monitoring.samples.at(-1).api.pool.total = 1;
    },
  ],
  [
    'HTTP sockets retained',
    (f) => {
      f.monitoring.samples.at(-1).network.activeConnections = 1;
    },
  ],
  [
    'missing resource coverage',
    (f) => {
      f.monitoring.samples = f.monitoring.samples.filter(
        (s) => s.phase !== 'soak-window-5',
      );
    },
  ],
  [
    'memory ceiling breach',
    (f) => {
      f.monitoring.samples[200].process.rssBytes = 2 * 1024 * MiB;
    },
  ],
  [
    'unrotated tokens',
    (f) => {
      f.workload.refreshes = 0;
    },
  ],
  [
    'unrevoked sessions',
    (f) => {
      f.evidence.revoked = 0;
    },
  ],
  [
    'unexpected business writes',
    (f) => {
      f.evidence.ordersUnchanged = false;
    },
  ],
  [
    'latency deterioration',
    (f) => {
      for (const w of f.workload.windows.slice(-3)) w.byKind.menu.p95Ms = 300;
    },
  ],
])
  await test(`rejects ${String(label)}`, () => {
    const f = fixture();
    change(f);
    assert.equal(evaluate(f).pass, false);
  });
await test('robust growth flags catch sustained heap/native/handle leaks', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    minute: i,
    heapLow: (40 + i * 4) * MiB,
    rssLow: (200 + i * 12) * MiB,
    externalLow: (5 + i * 2) * MiB,
    socketLow: 7 + i,
    timerLow: 200 + i * 30,
  }));
  assert.ok(Object.values(analyzeSoakMemory(rows)).every((t) => t.suspected));
  assert.equal(
    robustSlope([
      { minute: 0, value: 1 },
      { minute: 1, value: 3 },
      { minute: 2, value: 5 },
    ]),
    2,
  );
});
await test('early allocator growth that plateaus does not claim a sustained leak', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    minute: i,
    heapLow: (40 + Math.min(i, 3) * 8) * MiB,
    rssLow: (200 + Math.min(i, 3) * 32) * MiB,
    externalLow: 5 * MiB,
    socketLow: 7,
    timerLow: 200,
  }));
  assert.ok(Object.values(analyzeSoakMemory(rows)).every((t) => !t.suspected));
});
await test('fixed profile selection strips inherited duration and target options', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'owned',
    report: 'report',
  };
  assert.equal(
    loadFixtureEnvironment(
      { LOAD_SOAK_PROFILE: 'extended', LOAD_SOAK_SECONDS: '1' },
      options,
    ).LOAD_SOAK_PROFILE,
    '',
  );
  assert.equal(
    loadFixtureEnvironment({}, { ...options, soak: 'extended' })
      .LOAD_SOAK_PROFILE,
    'extended',
  );
  assert.throws(() => soakProfile('arbitrary'));
  assert.throws(() =>
    loadFixtureEnvironment({}, { ...options, soak: 'arbitrary' }),
  );
});

await test('multi-hour profile requires three hours and rotates sessions throughout', () => {
  const p = soakProfile('multi-hour');
  assert.equal(p.windows * p.windowSeconds, 3 * 60 * 60);
  assert.equal(expectedSoakSessions(p), 183);
  assert.equal(expectedSoakRefreshes(p), 270);
});

await test('background workers are reported separately and do not spend the client pool budget', () => {
  const f = fixture();
  for (const s of f.monitoring.samples) {
    s.database.backgroundConnections = 3;
    s.database.activityBackends = s.database.clientConnections + 3;
    s.database.connections = s.database.activityBackends;
  }
  assert.equal(evaluate(f).pass, true);
});

await test('log capture counts without retaining sensitive messages and restores hooks', () => {
  const capture = soakLogs(),
    warn = console.warn,
    error = console.error;
  capture.install();
  try {
    capture.logger.warn('private fixture data');
    capture.logger.error({ secret: 'not retained' });
    capture.logger.fatal('not retained');
    console.warn('not retained');
    console.error('not retained');
    // Invoke only this capture listener; do not broadcast a synthetic warning.
    process.listeners('warning').at(-1)();
    assert.deepEqual(capture.snapshot(), {
      enabled: true,
      warn: 2,
      error: 2,
      fatal: 1,
      processWarning: 1,
    });
    assert.equal(capture.begin().processWarning, 1);
    assert.equal(capture.snapshot().warn, 0);
    capture.logger.warn('measured warning');
    assert.equal(capture.snapshot().warn, 1);
    assert.throws(() => capture.begin());
  } finally {
    capture.restore();
  }
  assert.equal(console.warn, warn);
  assert.equal(console.error, error);
});

await test('database log audit rejects warnings/errors and missing logs without exporting text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paserve-soak-log-'));
  const file = join(dir, 'postgres.log');
  try {
    await writeFile(file, '2026 [1] LOG: ready\n');
    assert.equal((await auditSoakDatabaseLog(file)).pass, true);
    await writeFile(
      file,
      '2026 [1] WARNING: private text\n2026 [1] ERROR: private query\n',
    );
    const result = await auditSoakDatabaseLog(file);
    assert.equal(result.pass, false);
    assert.equal(result.counts.WARNING, 1);
    assert.equal(result.counts.ERROR, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
    await assert.rejects(auditSoakDatabaseLog(join(dir, 'missing.log')));
    await assert.rejects(auditSoakDatabaseLog(file, -1));
    await assert.rejects(auditSoakDatabaseLog(file, 100000));
    await writeFile(file, '2026 [1] WARNING: setup only\n');
    const bytes = (await stat(file)).size;
    await writeFile(
      file,
      '2026 [1] WARNING: setup only\n2026 [1] LOG: measured clean\n',
    );
    assert.equal((await auditSoakDatabaseLog(file, bytes)).pass, true);
  } finally {
    await unlink(file);
    await rmdir(dir);
  }
});
