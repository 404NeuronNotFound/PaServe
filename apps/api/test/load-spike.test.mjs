import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrafficSpike } from './load-spike.metrics.mjs';
import {
  spikeProfile,
  spikeKinds,
  validMixedSpike,
} from './load-spike.workload.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';
import { overloadSpikeProfile } from './load-spike.overload.mjs';

function fixture() {
  const stages = spikeProfile.phases.map((phase, i) => {
    const clients = spikeProfile.levels[i],
      samples = Array.from({ length: 8 }, (_, wave) =>
        Array.from({ length: clients }, (_, client) => ({
          kind: spikeKinds[(client + wave) % 4],
          wave,
          client,
          tenant: (client + wave) % 3,
          ok: true,
          status: '200',
          ms: 100,
        })),
      ).flat();
    return {
      phase,
      clients,
      samples,
      requests: samples.length,
      successes: samples.length,
      errorRate: 0,
      p95Ms: 100,
      p99Ms: 100,
      missed: 0,
      missedProbes: 0,
      startDelayMs: 5,
      workflows: Object.fromEntries(
        spikeKinds.map((kind) => [
          kind,
          {
            successes: samples.filter((s) => s.kind === kind).length,
            errorRate: 0,
            p95Ms: 100,
            p99Ms: 100,
          },
        ]),
      ),
      probes: Array.from({ length: 8 }, (_, wave) =>
        ['cashier', 'kitchen', 'health'].map((kind) => ({
          kind,
          tenant: wave % 3,
          ok: true,
          status: '200',
          ms: 100,
        })),
      ).flat(),
      login: [{ ok: true, status: '200', ms: 100 }],
      waves: Array.from({ length: 8 }, (_, wave) => ({
        wave,
        started: clients,
        launchSpreadMs: 10,
        maximumDispatchDelayMs: 10,
      })),
    };
  });
  return {
    workload: {
      profile: spikeProfile,
      stages,
      peakInFlight: 30,
      recoverySpikeDrainMs: 20,
      sessionsCreated: 6,
      sessionsRevoked: 6,
      overload: {
        profile: overloadSpikeProfile,
        launchSpreadMs: 10,
        peakInFlight: 52,
        menus: Array.from({ length: 48 }, (_, i) =>
          i < 24
            ? { status: '200', valid: true, ms: 50 }
            : {
                status: '503',
                code: 'API_OVERLOADED',
                noStore: true,
                retryAfterSeconds: 1,
                ms: 20,
              },
        ),
        rate: Array.from({ length: 20 }, (_, i) =>
          i < 10
            ? { status: '401', code: 'INVALID_SESSION', ms: 5 }
            : {
                status: '429',
                code: 'RATE_LIMIT_EXCEEDED',
                noStore: true,
                retryAfterSeconds: 10,
                ms: 5,
              },
        ),
        probes: Array.from({ length: 6 }, () => ({ ok: true, ms: 50 })),
        recovery: Array.from({ length: 40 }, () => ({ ok: true, ms: 50 })),
        rateRecovery: {
          status: '401',
          code: 'INVALID_SESSION',
          ms: 5,
          waitedMs: 10100,
        },
      },
    },
    monitoring: {
      sampleFailures: 0,
      truncated: false,
      http: { statusCounts: { 200: 299, 429: 10, 503: 24 } },
      samples: [
        ...spikeProfile.phases,
        'overload',
        'overload-recovery',
      ].flatMap((phase, i) =>
        Array.from({ length: 81 }, (_, j) => ({
          phase: `traffic-spike-${phase}`,
          elapsedMs: 100000 + i * 8000 + j * 100,
          api: {
            pool: { total: 5, waiting: 0, policy: { max: 5, maxWaiting: 20 } },
          },
          database: { connections: 7 },
          process: { cpuCoreEquivalent: 1, rssBytes: 1000 },
        })),
      ),
    },
    evidence: {
      sessions: 6,
      revoked: 6,
      ordersUnchanged: true,
      linesUnchanged: true,
      usersUnchanged: true,
      productsUnchanged: true,
      paidUnchanged: true,
      protection: {
        before: {
          gate: { rejected: 0 },
          pool: { rejected: 0 },
          passwords: { started: 7 },
        },
        after: {
          gate: {
            rejected: 24,
            peakActive: 4,
            peakWaiting: 20,
            limits: { active: 4, waiting: 20 },
          },
          capacity: { peak: 52, limits: { total: 128 } },
          pool: { rejected: 0 },
          passwords: { started: 7 },
        },
        recovered: {
          gate: { active: 0, waiting: 0 },
          capacity: { active: { total: 0 } },
          pool: { waiting: 0 },
          passwords: { active: 0 },
        },
      },
    },
  };
}
const evaluate = (f) =>
  evaluateTrafficSpike(f.workload, f.monitoring, f.evidence);
await test('accepts a fully monitored fixed 2->24->2 spike with recovery and bounded sessions', () =>
  assert.equal(evaluate(fixture()).pass, true));
for (const [name, mutate] of [
  [
    'missing overload proof',
    (f) => {
      f.workload.overload = undefined;
    },
  ],
  [
    'backpressure not exercised',
    (f) => {
      for (const s of f.workload.overload.menus) {
        s.status = '200';
        s.valid = true;
      }
    },
  ],
  [
    'rate limits not exercised',
    (f) => {
      f.workload.overload.rate[10].status = '401';
    },
  ],
  [
    'invalid retry policy',
    (f) => {
      f.workload.overload.menus[24].retryAfterSeconds = null;
    },
  ],
  [
    'slow load shedding',
    (f) => {
      f.workload.overload.menus[24].ms = 1001;
    },
  ],
  [
    'incorrect gate rejection attribution',
    (f) => {
      f.evidence.protection.after.gate.rejected = 0;
    },
  ],
  [
    'global saturation before shedding',
    (f) => {
      f.evidence.protection.after.capacity.peak = 128;
    },
  ],
  [
    'DB pool exhaustion',
    (f) => {
      f.evidence.protection.after.pool.rejected = 1;
    },
  ],
  [
    'hash work during cheap refresh abuse',
    (f) => {
      f.evidence.protection.after.passwords.started++;
    },
  ],
  [
    'unresponsive protected requests',
    (f) => {
      f.workload.overload.probes[0].ok = false;
    },
  ],
  [
    'unfinished recovery',
    (f) => {
      f.evidence.protection.recovered.gate.waiting = 1;
    },
  ],
  [
    'limiter still closed after cooldown',
    (f) => {
      f.workload.overload.rateRecovery.status = '429';
    },
  ],
  [
    'gradual or wrong level',
    (f) => {
      f.workload.stages[1].clients = 12;
    },
  ],
  [
    'late phase transition',
    (f) => {
      f.workload.stages[2].startDelayMs = 151;
    },
  ],
  [
    'missed offered load',
    (f) => {
      f.workload.stages[1].missed = 1;
    },
  ],
  [
    'staggered spike launch',
    (f) => {
      f.workload.stages[1].waves[0].launchSpreadMs = 101;
    },
  ],
  [
    'too much driver work',
    (f) => {
      f.workload.peakInFlight = 65;
    },
  ],
  [
    'failed measured login',
    (f) => {
      f.workload.stages[1].login[0].ok = false;
    },
  ],
  [
    'slow cashier',
    (f) => {
      f.workload.stages[1].probes[0].ms = 1001;
    },
  ],
  [
    'unusable kitchen',
    (f) => {
      f.workload.stages[1].probes[1].ok = false;
    },
  ],
  [
    'slow spike',
    (f) => {
      f.workload.stages[1].p95Ms = 1001;
    },
  ],
  [
    'slow recovery',
    (f) => {
      f.workload.recoverySpikeDrainMs = 1501;
    },
  ],
  [
    'hidden 503 controls',
    (f) => {
      f.monitoring.http.statusCounts['503'] = 1;
    },
  ],
  [
    'pool overflow',
    (f) => {
      f.monitoring.samples[81].api.pool.waiting = 21;
    },
  ],
  [
    'too many DB connections',
    (f) => {
      f.monitoring.samples[81].database.connections = 8;
    },
  ],
  [
    'missing monitoring coverage',
    (f) => {
      f.monitoring.samples = f.monitoring.samples.filter(
        (s) => s.phase !== 'traffic-spike-spike',
      );
    },
  ],
  [
    'unrevoked sessions',
    (f) => {
      f.evidence.revoked = 5;
    },
  ],
  [
    'unexpected order writes',
    (f) => {
      f.evidence.ordersUnchanged = false;
    },
  ],
])
  await test(`rejects ${String(name)}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).pass, false);
  });
await test('tracking validation rejects foreign tenants and incorrect receipt prices', () => {
  const account = { shopId: 'shop', orderId: 'order' },
    data = {
      order: {
        id: 'order',
        shopId: 'shop',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'UNPAID',
      },
      receipt: { totalPrice: '37.00' },
    };
  assert.equal(validMixedSpike('order-status', data, account), true);
  data.order.shopId = 'foreign';
  assert.equal(validMixedSpike('order-status', data, account), false);
  data.order.shopId = 'shop';
  data.receipt.totalPrice = '99.00';
  assert.equal(validMixedSpike('order-status', data, account), false);
});
await test('inherited spike flags cannot enable or resize the owned profile', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'owned-fixture',
    report: 'report',
  };
  const env = loadFixtureEnvironment(
    { LOAD_TRAFFIC_SPIKE: '1', LOAD_SPIKE_CLIENTS: '10000' },
    options,
  );
  assert.equal(env.LOAD_TRAFFIC_SPIKE, '0');
  assert.equal(env.LOAD_SPIKE_CLIENTS, undefined);
  assert.equal(
    loadFixtureEnvironment({}, { ...options, trafficSpike: true })
      .LOAD_TRAFFIC_SPIKE,
    '1',
  );
});
