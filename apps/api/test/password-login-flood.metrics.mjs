export function summarizeTimes(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) =>
    sorted.length
      ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100
      : null;
  return {
    samples: sorted.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
    tailSampleSufficient: sorted.length >= 100,
  };
}

export function evaluateLocalFlood({
  policy,
  configuredThreadpoolSize,
  server,
  attacker,
  healthy,
  overlapHealthy,
  cleanLogins,
  poolProbe,
  missedProbeSchedules,
}) {
  const checks = {
    existingSecurePolicyPreserved:
      policy.type === 2 &&
      policy.version === 19 &&
      policy.memoryCost === 65_536 &&
      policy.timeCost === 3 &&
      policy.parallelism === 4 &&
      policy.hashLength === 32,
    cpuRecordedDuringRealHashing:
      server.cpuSamples.length >= 2 &&
      server.cpuSamples.some(
        (sample) => sample.activeHashJobs > 0 && sample.cpuCoreEquivalent > 0,
      ) &&
      server.native.measuredVerifyJobs > 0,
    nativeJobAndMemoryBounds:
      server.native.maxConcurrent < configuredThreadpoolSize &&
      server.native.peakActive <= server.native.maxConcurrent &&
      server.native.peakReservedKiB <= server.native.memoryBudgetKiB &&
      server.native.active === 0 &&
      server.native.reservedKiB === 0,
    realDistinctClients: server.distinctSocketPeersObserved,
    attackerThrottled:
      (attacker.statuses['429'] ?? 0) > 0 &&
      attacker.unexpected === 0 &&
      attacker.networkErrors === 0,
    rateLimitedBeforeExcessiveVerification:
      attacker.earlyIpRejections > 0 &&
      server.activity.attackerLoginReads <= 10,
    healthyRequestsSucceeded:
      healthy.failures === 0 &&
      healthy.latency.samples > 0 &&
      healthy.latency.p95Ms <= 500 &&
      missedProbeSchedules === 0,
    healthyRequestsDuringHashing:
      server.overlapRequests > 0 &&
      overlapHealthy.samples > 0 &&
      overlapHealthy.p95Ms <= 500,
    remainingWorkerPoolProgress:
      server.fsFailures === 0 &&
      poolProbe.activeAtStart > 0 &&
      poolProbe.ms <= 500,
    legitimateLoginAndRecovery:
      cleanLogins.failures === 0 &&
      cleanLogins.latency.samples >= 2 &&
      cleanLogins.latency.p95Ms <= 1000,
    noAttackerSessionWrites: server.activity.attackerSessionWrites === 0,
    noExternalProviderCalls: server.externalFetchAttempts === 0,
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}
