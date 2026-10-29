import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { LoadMonitor, assertLoadMonitoring } from './load-monitor.mjs';
import { loadDatasetPlan } from './load-dataset.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';

await test('dataset profiles bound all three tenant sizes and reject arbitrary volumes', () => {
  for (const [profile, products, orders] of [
    ['smoke', 82, 430],
    ['representative', 620, 33300],
    ['large', 2600, 111000],
  ]) {
    const plan = loadDatasetPlan(profile);
    assert.equal(plan.tenants.length, 3);
    assert.equal(
      plan.tenants.reduce((n, t) => n + t.products, 0),
      products,
    );
    assert.equal(
      plan.tenants.reduce((n, t) => n + t.orders, 0),
      orders,
    );
    assert.equal(
      plan.tenants.reduce(
        (n, t) => n + Object.values(t.roles).reduce((a, b) => a + b, 0),
        0,
      ),
      24,
    );
    assert.equal(plan.historyDays, 180);
  }
  for (const invalid of ['production', '1000000000', '__proto__', ''])
    assert.throws(() => loadDatasetPlan(invalid));
  assert.equal(loadDatasetPlan().profile, 'representative');
});

await test('fixture environment accepts only bounded dataset profiles', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'fixture-directory',
    report: 'fixture-report',
  };
  assert.equal(
    loadFixtureEnvironment({ LOAD_DATASET_PROFILE: 'large' }, options)
      .LOAD_DATASET_PROFILE,
    'large',
  );
  assert.throws(() =>
    loadFixtureEnvironment({ LOAD_DATASET_PROFILE: 'unbounded' }, options),
  );
});

await test('collector records real HTTP socket bytes, API snapshots and database samples; gaps fail acceptance', async () => {
  let ended = false;
  const server = createServer((_req, res) => res.end('synthetic response'));
  const monitor = new LoadMonitor({
    client: {
      connect: async () => {},
      end: async () => {
        ended = true;
      },
      query: async () => {
        return {
          rows: [
            {
              connections: 2,
              active: 0,
              lock_waiters: 0,
              xact_commit: 5,
              bytes: 1000,
            },
          ],
        };
      },
    },
    phase: () => 'optional-search',
    apiSnapshot: () => ({
      pool: { total: 1, waiting: 0 },
      capacity: { active: { total: 0 }, admitted: 1 },
      fairness: { activeScopeLeases: 0 },
    }),
  });
  monitor.attachHttp(server);
  try {
    await monitor.start();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      headers: { connection: 'close' },
    });
    assert.equal(await response.text(), 'synthetic response');
    await monitor.sampleNow();
    const report = await monitor.stop();
    assertLoadMonitoring(report, { search: true });
    assert.equal(ended, true);
    assert.equal(report.http.completed, 1);
    assert.equal(report.http.statusCounts['200'], 1);
    assert.ok(report.network.receivedBytes > 0 && report.network.sentBytes > 0);
    for (const mutate of [
      (r) => {
        r.sampleFailures = 1;
      },
      (r) => {
        r.truncated = true;
      },
      (r) => {
        r.samples = r.samples.slice(0, 2);
      },
      (r) => {
        r.samples[0].api = {};
      },
      (r) => {
        r.samples[0].database.connections = null;
      },
      (r) => {
        r.network.sentBytes = 0;
      },
    ]) {
      const incomplete = structuredClone(report);
      mutate(incomplete);
      assert.throws(() => assertLoadMonitoring(incomplete, { search: true }));
    }
  } finally {
    await monitor.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('database sampling errors and exhausted sample budgets fail closed', async () => {
  let unavailable = false;
  const monitor = new LoadMonitor({
    client: {
      connect: async () => {},
      end: async () => {},
      query: async () => {
        if (unavailable) throw new Error('unavailable');
        return { rows: [{ connections: 1 }] };
      },
    },
    phase: () => 'fixtures',
    maxSamples: 2,
  });
  try {
    await monitor.start();
    unavailable = true;
    await monitor.sampleNow();
    assert.equal(monitor.sampleFailures, 1);
    unavailable = false;
    await monitor.sampleNow();
    const report = await monitor.stop();
    assert.equal(report.samples.length, 2);
    assert.equal(report.truncated, true);
    assert.throws(() => assertLoadMonitoring(report));
  } finally {
    await monitor.stop();
  }
});
