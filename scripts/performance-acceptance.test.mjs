import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evidenceManifest, assessMinimumPerformance, acceptanceMarkdown } from './performance-acceptance.mjs';

const input = {};
for (const [key, file] of Object.entries(evidenceManifest)) {
  input[key] = JSON.parse(await readFile(new URL(`../artifacts/performance/${file}`, import.meta.url), 'utf8'));
}
const item = (report, id) => report.items.find((row) => row.id === id);

test('recorded local evidence supports nine criteria without granting provider/deployment approval', () => {
  const report = assessMinimumPerformance(input);
  assert.equal(report.items.length, 10);
  assert.equal(report.items.filter((row) => row.status === 'PASS').length, 9);
  assert.equal(report.status, 'CONDITIONAL');
  assert.equal(report.deploymentReady, false);
  assert.equal(item(report, 'pool-and-provider-budget').status, 'CONDITIONAL');
  assert.match(acceptanceMarkdown(report), /original aggregate-count gate remains failed/);
  assert.match(acceptanceMarkdown(report), /not a current deployed guarantee|current revision/);
});

test('missing pool telemetry cannot pass abuse or pool gates', () => {
  const monitoring = input.login.report.monitoring;
  const saved = monitoring.samples;
  try {
    monitoring.samples = [{}, {}];
    const report = assessMinimumPerformance(input);
    assert.equal(item(report, 'abuse-before-exhaustion').status, 'FAIL');
    assert.equal(item(report, 'pool-and-provider-budget').status, 'FAIL');
  } finally { monitoring.samples = saved; }
});

test('failed tenant assertion invalidates isolation even if aggregate pass remains true', () => {
  const check = input.tenants.checks[0];
  const saved = check.pass;
  try {
    check.pass = false;
    assert.equal(item(assessMinimumPerformance(input), 'tenant-isolation').status, 'FAIL');
  } finally { check.pass = saved; }
});

test('incomplete targeted monitor verification cannot certify long-soak correction', () => {
  const env = input.soakTargeted.environment;
  const saved = env.status;
  try {
    env.status = 'incomplete';
    assert.equal(item(assessMinimumPerformance(input), 'soak-leaks').status, 'FAIL');
  } finally { env.status = saved; }
});

test('damaged recovery evidence fails recovery and repeatability criteria', () => {
  const saved = input.failure.workload.latency.samples;
  try {
    input.failure.workload.latency.samples = 0;
    const report = assessMinimumPerformance(input);
    assert.equal(item(report, 'spike-dependency-recovery').status, 'FAIL');
    assert.equal(item(report, 'repeatable-stress-report').status, 'FAIL');
  } finally { input.failure.workload.latency.samples = saved; }
});
