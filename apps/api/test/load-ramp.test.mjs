import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rampProfile,
  summarizeRamp,
  analyzeRampDegradation,
} from './load-ramp.mjs';
import { validateRampResponse } from './load-ramp.client-workload.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';

function fixture() {
  return {
    workload: {
      identities: 3,
      shops: 3,
      testSessionsCreated: 3,
      testSessionsRevoked: 3,
      stages: rampProfile.levels.map((virtualClients) => ({
        virtualClients,
        elapsedSeconds: 45,
        requests: 108,
        sampleSufficient: true,
        sloPass: true,
        p95Ms: 100,
        p99Ms: 200,
        errorRate: 0,
        missedRate: 0,
        byWorkflow: Object.fromEntries(
          ['menu', 'login', 'dashboard', 'order-status'].map((kind) => [
            kind,
            {
              requests: kind === 'login' ? 1 : 35,
              successes: kind === 'login' ? 1 : 35,
              p95Ms: 100,
              p99Ms: 200,
              errorRate: 0,
              missedRate: 0,
            },
          ]),
        ),
      })),
    },
    monitoring: {
      samples: rampProfile.levels.flatMap((n, index) =>
        Array.from({ length: 89 }, (_, i) => i * 500).map((offset) => ({
          phase: `ramp-${n}`,
          elapsedMs: index * 45000 + offset,
          process: {
            cpuCoreEquivalent: 0.5,
            rssBytes: 1000,
            eventLoopP95Ms: 20,
          },
          database: { connections: 5, active: 1, lock_waiters: 0 },
          api: {
            pool: { total: 3, waiting: 0, pendingCheckouts: 0, rejected: 0 },
            capacity: { active: { total: 2 }, rejected: { total: 0 } },
            fairness: {
              rateRejected: 0,
              concurrencyRejected: 0,
              capacityRejected: 0,
            },
          },
          network: { receivedBytes: offset, sentBytes: offset * 2 },
        })),
      ),
    },
  };
}

await test('ramp requires all plateaus, sufficient samples, budgets and session cleanup', () => {
  const { workload, monitoring } = fixture();
  const report = summarizeRamp(workload, monitoring);
  assert.equal(report.pass, true);
  assert.equal(report.highestPassingVirtualClients, 8);
  assert.equal(report.stages[0].resources.receivedBytes, 44000);
  assert.equal(report.stages[0].resources.peakPoolTotal, 3);
  for (const mutate of [
    (w) => {
      w.stages.pop();
    },
    (w) => {
      w.testSessionsRevoked = 2;
    },
    (w) => {
      w.stages[0].sampleSufficient = false;
    },
    (w) => {
      w.stages[0].requests = 0;
    },
    (w) => {
      w.stages[0].p99Ms = 1501;
    },
    (w) => {
      w.stages[0].p95Ms = null;
    },
    (w) => {
      w.stages[0].errorRate = 0.02;
    },
    (w) => {
      w.stages[0].missedRate = 0.02;
    },
    (w) => {
      w.stages[0].elapsedSeconds = 44;
    },
    (w) => {
      delete w.stages[0].byWorkflow.dashboard;
    },
    (w) => {
      w.stages[0].byWorkflow.dashboard.errorRate = 0.5;
    },
    (w) => {
      w.stages[0].byWorkflow.menu.p99Ms = null;
    },
  ]) {
    const copy = structuredClone(workload);
    mutate(copy);
    assert.equal(summarizeRamp(copy, monitoring).pass, false);
  }
});

await test('latency onset needs a meaningful sustained same-workflow increase; throttling is classified separately', () => {
  const { workload } = fixture();
  workload.stages[1].byWorkflow.menu.p95Ms = 160;
  assert.equal(analyzeRampDegradation(workload.stages).latencyOnset, null);
  workload.stages[2].byWorkflow.menu.p95Ms = 170;
  assert.equal(
    analyzeRampDegradation(workload.stages).latencyOnset.virtualClients,
    4,
  );
  workload.stages[1].byWorkflow.menu.errorRate = 0.1;
  workload.stages[1].statusCounts = { 429: 10 };
  const result = analyzeRampDegradation(workload.stages);
  assert.equal(result.latencyOnset, null);
  assert.equal(result.firstProtectionLimitedVirtualClients, 4);
});

await test('mixed responses validate the target tenant, receipt and bounded public catalog', () => {
  const account = {
    shopId: 'shop-a',
    orderId: 'order-a',
    userId: 'user-a',
    slug: 'shop-a',
    menuProductIds: ['product-a'],
  };
  assert.equal(
    validateRampResponse(
      'menu',
      { shop: { slug: 'shop-a' }, products: [{ id: 'product-a' }] },
      account,
    ),
    true,
  );
  assert.equal(
    validateRampResponse(
      'menu',
      { shop: { slug: 'shop-b' }, products: [{ id: 'product-a' }] },
      account,
    ),
    false,
  );
  assert.equal(
    validateRampResponse(
      'order-status',
      {
        order: {
          shopId: 'shop-b',
          id: 'order-a',
          status: 'PENDING_CONFIRMATION',
        },
      },
      account,
    ),
    false,
  );
  assert.equal(
    validateRampResponse(
      'login',
      { accessToken: 'synthetic', user: { id: 'user-b' } },
      account,
    ),
    false,
  );
  assert.equal(
    validateRampResponse(
      'dashboard',
      {
        shopId: 'shop-b',
        businessDate: '2026-10-29',
        totalSales: '0.00',
        completedOrders: 0,
      },
      account,
      '2026-10-29',
    ),
    false,
  );
});

await test('ramp refuses wrong levels and missing or incomplete resource coverage', () => {
  const { workload, monitoring } = fixture();
  workload.stages[0].virtualClients = 200;
  assert.throws(() => summarizeRamp(workload, monitoring));
  workload.stages[0].virtualClients = 2;
  monitoring.samples.splice(0, 10);
  assert.throws(() => summarizeRamp(workload, monitoring));
});

await test('ramp fails for gaps inside otherwise complete coverage or missing resource counters', () => {
  const { workload, monitoring } = fixture();
  const gap = structuredClone(monitoring);
  gap.samples.splice(10, 10);
  assert.throws(() => summarizeRamp(workload, gap));
  delete monitoring.samples[0].api.pool.rejected;
  assert.throws(() => summarizeRamp(workload, monitoring));
});

await test('partial failed ramps retain the failing level and cannot claim completion', () => {
  const { workload, monitoring } = fixture();
  workload.stages = workload.stages.slice(0, 2);
  workload.stages[1].sloPass = false;
  workload.stages[1].errorRate = 0.2;
  const report = summarizeRamp(workload, monitoring);
  assert.equal(report.pass, false);
  assert.equal(report.completed, false);
  assert.equal(report.firstFailingVirtualClients, 4);
  assert.equal(report.highestPassingVirtualClients, 2);
});

await test('ramp mode comes from the managed runner, not inherited workload flags', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'fixture-directory',
    report: 'fixture-report',
  };
  assert.equal(
    loadFixtureEnvironment(
      { LOAD_FIXTURE_RAMP: '1', LOAD_LEVELS: '200' },
      options,
    ).LOAD_FIXTURE_RAMP,
    '0',
  );
  const managed = loadFixtureEnvironment({}, { ...options, ramp: true });
  assert.equal(managed.LOAD_FIXTURE_RAMP, '1');
  assert.equal(managed.LOAD_LEVELS, undefined);
  assert.equal(
    loadFixtureEnvironment({ LOAD_RAMP_DIAGNOSTIC: '1' }, options)
      .LOAD_RAMP_DIAGNOSTIC,
    '0',
  );
  assert.equal(
    loadFixtureEnvironment({}, { ...options, ramp: true, diagnostic: true })
      .LOAD_RAMP_DIAGNOSTIC,
    '1',
  );
});
