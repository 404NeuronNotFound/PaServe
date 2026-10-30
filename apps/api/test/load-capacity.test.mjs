import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../../../scripts/order-search-load.mjs';
import {
  capacityProfile as p,
  capacityKinds,
  capacityConclusion,
  capacityStageVerdict,
} from './load-capacity.profile.mjs';
import { evaluateCapacity } from './load-capacity.metrics.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';
import { instrumentCapacity } from './capacity-attribution.mjs';

function stage(role, offeredRps, index, fail = false) {
  const seconds = role === 'headroom' ? p.headroomSeconds : p.seconds;
  const samples = Array.from({ length: offeredRps * seconds }, (_, i) => ({
    kind: capacityKinds[i % 4],
    status: fail && i % 10 === 0 ? '429' : '200',
    ok: !(fail && i % 10 === 0),
    ms: 50,
  }));
  return {
    role,
    offeredRps,
    seconds,
    phase: `capacity-${role}-${index}`,
    ...summarize(samples, seconds),
    windows: Array.from({ length: seconds / p.seconds }, (_, index) => ({
      index,
      ...summarize(
        samples.slice(
          index * offeredRps * p.seconds,
          (index + 1) * offeredRps * p.seconds,
        ),
        p.seconds,
      ),
    })),
    byKind: Object.fromEntries(
      capacityKinds.map((k) => [
        k,
        summarize(
          samples.filter((s) => s.kind === k),
          seconds,
        ),
      ]),
    ),
    probes: Array.from({ length: seconds * 3 }, (_, i) => ({
      kind: ['health', 'cashier', 'kitchen'][i % 3],
      status: '200',
      tenant: Math.floor(i / 3) % 3,
      ok: true,
      ms: 50,
    })),
    missedProbes: 0,
    invalidRetryAfter: 0,
  };
}
function fixture() {
  const stages = [
    stage('level', 4, 0),
    stage('level', 8, 1, true),
    stage('confirmation', 8, 1, true),
    stage('recovery', 4, 0),
    stage('headroom', 2, 0),
  ];
  const resource = (phase, elapsedMs, idle = false) => ({
    phase,
    elapsedMs,
    process: {
      rssBytes: 200 * 1048576,
      heapUsedBytes: 50 * 1048576,
      cpuCoreEquivalent: 0.5,
      eventLoopP95Ms: 20,
    },
    database: {
      connections: idle ? 4 : 9,
      clientConnections: idle ? 2 : 7,
      backgroundConnections: 2,
      activityBackends: idle ? 4 : 9,
      active: 1,
      lock_waiters: 0,
    },
    api: {
      databaseCpu: { healthy: true, cores: 0.7, ageMs: 1000, processes: 8 },
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
    },
    network: { activeConnections: 0 },
  });
  return {
    workload: {
      profile: p,
      complete: true,
      stages,
      peakInFlight: 10,
      sessionsCreated: 3,
      sessionsRevoked: 3,
      controls: Array.from({ length: 6 }, (_, i) => ({
        kind: i < 3 ? 'login' : 'logout',
        ok: true,
        ms: 50,
      })),
    },
    monitoring: {
      sampleFailures: 0,
      truncated: false,
      samples: [
        ...stages.flatMap((s, i) =>
          Array.from({ length: s.seconds * 5 + 1 }, (_, j) =>
            resource(s.phase, i * 31000 + j * 200),
          ),
        ),
        ...Array.from({ length: 76 }, (_, i) =>
          resource('capacity-idle', 400000 + i * 200, true),
        ),
      ],
    },
    evidence: {
      attribution: {
        truncated: false,
        events: [
          {
            sequence: 1,
            elapsedMs: 35000,
            phase: 'capacity-level-1',
            component: 'IP-route-rate-limit',
            reason: 'window-exhausted',
            count: 20,
          },
        ],
      },
      ordersUnchanged: true,
      linesUnchanged: true,
      usersUnchanged: true,
      paidUnchanged: true,
      productsUnchanged: true,
      sessions: 3,
      revoked: 3,
    },
  };
}
const evaluate = (f) => evaluateCapacity(f.workload, f.monitoring, f.evidence);
await test('finds a confirmed policy boundary and preserves background/client distinction', () => {
  const r = evaluate(fixture());
  assert.equal(r.pass, true);
  assert.equal(r.conclusion.lastPassingOfferedRps, 4);
  assert.equal(r.conclusion.firstFailingOfferedRps, 8);
  assert.equal(r.conclusion.classification, 'policy-throttling');
});
for (const [name, mutate] of [
  [
    'slow workflow hidden by mixed latency',
    (f) => {
      f.workload.stages.at(-1).byKind.menu.p95Ms = 600;
      f.workload.stages.at(-1).byKind.menu.p99Ms = 700;
    },
  ],
  [
    'missing attribution',
    (f) => {
      delete f.evidence.attribution;
    },
  ],
  [
    'truncated attribution',
    (f) => {
      f.evidence.attribution.truncated = true;
    },
  ],
  [
    'stale database CPU',
    (f) => {
      f.monitoring.samples[100].api.databaseCpu.ageMs = 5000;
    },
  ],
  [
    'missing database CPU',
    (f) => {
      delete f.monitoring.samples[100].api.databaseCpu;
    },
  ],
  [
    'incomplete headroom',
    (f) => {
      f.workload.stages.at(-1).seconds = 30;
    },
  ],
  [
    'late headroom failure',
    (f) => {
      f.workload.stages.at(-1).windows.at(-1).successes--;
    },
  ],
  [
    'wrong headroom rate',
    (f) => {
      f.workload.stages.at(-1).offeredRps++;
    },
  ],
  [
    'headroom rejection',
    (f) => {
      f.evidence.attribution.events.push({
        sequence: 2,
        elapsedMs: 150000,
        phase: 'capacity-headroom-0',
        component: 'DB-connection-pool',
        reason: 'waiter-capacity',
        count: 1,
      });
    },
  ],
  [
    'missing probe workflow',
    (f) => {
      f.workload.stages[1].probes[0].kind = 'cashier';
    },
  ],
  [
    'missing tenant probes',
    (f) => {
      for (const probe of f.workload.stages[1].probes) probe.tenant = 0;
    },
  ],
  [
    'invalid probe latency',
    (f) => {
      f.workload.stages[1].probes[0].ms = NaN;
    },
  ],
  [
    'missing idle observation',
    (f) => {
      f.monitoring.samples = f.monitoring.samples
        .filter((s) => s.phase !== 'capacity-idle')
        .concat(f.monitoring.samples.at(-1));
    },
  ],
  ['missing confirmation', (f) => f.workload.stages.splice(2, 1)],
  ['missing recovery', (f) => f.workload.stages.splice(3, 1)],
  [
    'skipped level',
    (f) => {
      f.workload.stages[1].offeredRps = 16;
    },
  ],
  [
    'monitoring gap',
    (f) => {
      f.monitoring.samples.splice(10, 20);
    },
  ],
  [
    'truncated monitoring',
    (f) => {
      f.monitoring.truncated = true;
    },
  ],
  [
    'excess client connections',
    (f) => {
      f.monitoring.samples[100].database.clientConnections = 9;
    },
  ],
  [
    'unreleased pool lease',
    (f) => {
      f.monitoring.samples.at(-1).api.pool.released--;
    },
  ],
  [
    'unrevoked session',
    (f) => {
      f.evidence.revoked--;
    },
  ],
  [
    'business mutation',
    (f) => {
      f.evidence.ordersUnchanged = false;
    },
  ],
  [
    'unexpected response',
    (f) => {
      f.workload.stages[1].statusCounts['500'] = 1;
    },
  ],
  [
    'health failure',
    (f) => {
      f.workload.stages[1].probes[0].ok = false;
    },
  ],
  [
    'invalid staff probe payload',
    (f) => {
      f.workload.stages[1].probes[1].status = 'invalid_payload';
    },
  ],
  [
    'invalid retry policy',
    (f) => {
      f.workload.stages[1].invalidRetryAfter = 1;
    },
  ],
  [
    'driver ceiling',
    (f) => {
      const s = f.workload.stages[1];
      s.missedRate = 0.1;
    },
  ],
])
  await test(`rejects ${String(name)}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).pass, false);
  });
await test('all passing bounded levels establish a lower bound, not a hardware ceiling', () => {
  const stages = p.levels.map((n, i) => stage('level', n, i));
  const c = capacityConclusion(stages);
  assert.equal(c.classification, 'bounded-range-lower-bound');
  assert.equal(c.firstFailingOfferedRps, null);
  assert.equal(c.lastPassingOfferedRps, 256);
  assert.equal(c.candidatePlanningRps, null);
});
await test('unconfirmed, invalid and generator-limited failures cannot claim a confirmed API ceiling', () => {
  const a = stage('level', 4, 0),
    b = stage('level', 8, 1, true);
  assert.equal(capacityConclusion([a, b]).confirmed, false);
  const confirmation = stage('confirmation', 8, 1);
  assert.equal(capacityConclusion([a, b, confirmation]).confirmed, false);
  assert.equal(capacityStageVerdict({ ...a, p95Ms: NaN }).valid, false);
  assert.equal(
    capacityStageVerdict({ ...a, missedScheduledRequests: 1 }).valid,
    false,
  );
});
await test('fixed capacity flag and settings cannot be enabled or enlarged by inherited environment', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    report: 'owned',
    directory: 'owned',
  };
  assert.equal(
    loadFixtureEnvironment(
      { LOAD_CAPACITY: '1', LOAD_LEVELS: '10000' },
      options,
    ).LOAD_CAPACITY,
    '0',
  );
  const env = loadFixtureEnvironment(
    { LOAD_LEVELS: '10000' },
    { ...options, capacity: true },
  );
  assert.equal(env.LOAD_CAPACITY, '1');
  assert.equal(env.LOAD_LEVELS, undefined);
});

await test('attribution preserves returns, thrown errors and callback/promise pool contracts without retaining request data', async () => {
  const busy = Object.assign(new Error('private error'), {
    getStatus: () => 503,
  });
  const poolError = new Error('private pool data');
  const counts = { rejected: 0 },
    fairnessCounts = {
      rateRejected: 0,
      concurrencyRejected: 0,
      capacityRejected: 0,
    };
  const release = () => {};
  let rejectFairness = false;
  const services = {
    rateStorage: { increment: async () => ({ isBlocked: true }) },
    fairness: {
      snapshot: () => ({ ...fairnessCounts }),
      acquire: () => {
        if (!rejectFairness) return release;
        fairnessCounts.rateRejected++;
        throw busy;
      },
    },
    admission: {
      acquire() {
        throw busy;
      },
    },
    menuGate: { busy: () => busy },
    poolAdapter: {
      snapshot: () => ({ ...counts }),
      pool: {
        connect: (callback) => {
          counts.rejected++;
          if (callback) {
            queueMicrotask(() => callback(poolError, undefined, release));
            return;
          }
          return Promise.reject(poolError);
        },
      },
    },
  };
  const originals = [
    services.rateStorage.increment,
    services.fairness.acquire,
    services.poolAdapter.pool.connect,
  ];
  let time = 100,
    phase = 'capacity-level-0';
  const trace = instrumentCapacity(
    services,
    () => phase,
    () => ++time,
  );
  try {
    assert.equal(services.fairness.acquire('private fixture ID'), release);
    await services.rateStorage.increment('private bucket key');
    rejectFairness = true;
    assert.throws(
      () => services.fairness.acquire(),
      (e) => e === busy,
    );
    assert.throws(
      () => services.admission.acquire(),
      (e) => e === busy,
    );
    assert.equal(services.menuGate.busy(), busy);
    await new Promise((resolve) =>
      services.poolAdapter.pool.connect((error, client, done) => {
        assert.equal(error, poolError);
        assert.equal(client, undefined);
        assert.equal(done, release);
        resolve();
      }),
    );
    await assert.rejects(
      services.poolAdapter.pool.connect(),
      (e) => e === poolError,
    );
    const snapshot = trace.snapshot();
    assert.equal(snapshot.truncated, false);
    assert.equal(snapshot.events.length, 5);
    assert.equal(snapshot.events[0].component, 'IP-route-rate-limit');
    assert.equal(snapshot.events.at(-1).component, 'DB-connection-pool');
    assert.equal(snapshot.events.at(-1).count, 2);
    assert.ok(!JSON.stringify(snapshot).includes('private'));
    phase = 'other-fixture';
    await services.rateStorage.increment('private');
    assert.equal(trace.snapshot().events[0].count, 1);
  } finally {
    trace.restore();
  }
  assert.equal(services.rateStorage.increment, originals[0]);
  assert.equal(services.fairness.acquire, originals[1]);
  assert.equal(services.poolAdapter.pool.connect, originals[2]);
});
