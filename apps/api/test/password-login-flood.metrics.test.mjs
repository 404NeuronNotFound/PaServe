import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeTimes,
  evaluateLocalFlood,
} from './password-login-flood.metrics.mjs';

function healthyFixture() {
  return {
    policy: {
      type: 2,
      version: 19,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
      hashLength: 32,
    },
    configuredThreadpoolSize: 4,
    server: {
      cpuSamples: [
        { activeHashJobs: 2, cpuCoreEquivalent: 2 },
        { activeHashJobs: 0, cpuCoreEquivalent: 0.1 },
      ],
      native: {
        measuredVerifyJobs: 2,
        peakActive: 2,
        maxConcurrent: 2,
        peakReservedKiB: 131_072,
        memoryBudgetKiB: 131_072,
        active: 0,
        reservedKiB: 0,
      },
      distinctSocketPeersObserved: true,
      overlapRequests: 3,
      fsFailures: 0,
      activity: { attackerSessionWrites: 0, attackerLoginReads: 2 },
      externalFetchAttempts: 0,
    },
    attacker: {
      statuses: { 401: 2, 429: 100 },
      unexpected: 0,
      networkErrors: 0,
      earlyIpRejections: 100,
    },
    healthy: { failures: 0, latency: summarizeTimes([10, 20, 30]) },
    overlapHealthy: summarizeTimes([20, 30]),
    cleanLogins: { failures: 0, latency: summarizeTimes([150, 160, 170]) },
    poolProbe: { activeAtStart: 2, ms: 2 },
    missedProbeSchedules: 0,
  };
}

void test('local acceptance requires real hashing, spare worker progress and successful clients', () => {
  assert.equal(evaluateLocalFlood(healthyFixture()).pass, true);
});
void test('empty latency samples cannot turn an unexercised workflow into a pass', () => {
  const empty = summarizeTimes([]);
  assert.equal(empty.p95Ms, null);
  assert.equal(empty.tailSampleSufficient, false);
  const input = healthyFixture();
  input.overlapHealthy = empty;
  assert.equal(evaluateLocalFlood(input).pass, false);
});
for (const [name, alter] of [
  [
    'weaker hashing',
    (value) => {
      value.policy.memoryCost = 8192;
    },
  ],
  [
    'only fast 429s and no real verification',
    (value) => {
      value.server.native.measuredVerifyJobs = 0;
    },
  ],
  [
    'CPU observed only outside hash work',
    (value) => {
      value.server.cpuSamples.forEach((sample) => {
        sample.activeHashJobs = 0;
      });
    },
  ],
  [
    'healthy requests succeeded only when idle',
    (value) => {
      value.server.overlapRequests = 0;
    },
  ],
  [
    'all pool workers eligible for hashes',
    (value) => {
      value.server.native.maxConcurrent = 4;
    },
  ],
  [
    'native memory exceeded',
    (value) => {
      value.server.native.peakReservedKiB = 262144;
    },
  ],
  [
    'one healthy HTTP failure',
    (value) => {
      value.healthy.failures = 1;
    },
  ],
  [
    'legitimate login throttled',
    (value) => {
      value.cleanLogins.failures = 1;
    },
  ],
  [
    'no proof of early IP enforcement',
    (value) => {
      value.attacker.earlyIpRejections = 0;
    },
  ],
  [
    'filesystem work starved',
    (value) => {
      value.poolProbe.ms = 900;
    },
  ],
  [
    'native work still running at finish',
    (value) => {
      value.server.native.active = 1;
    },
  ],
  [
    'missed healthy probe schedules',
    (value) => {
      value.missedProbeSchedules = 1;
    },
  ],
])
  void test(`acceptance fails for ${String(name)}`, () => {
    const input = healthyFixture();
    alter(input);
    assert.equal(evaluateLocalFlood(input).pass, false);
  });
