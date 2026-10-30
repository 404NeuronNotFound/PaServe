import { menuSpikeProfile, menuSpikeStages } from './menu-spike.workload.mjs';

export function evaluateMenuSpike(workload, monitoring, evidence) {
  const stages = workload.stages.map((stage, i) => {
    const cache = evidence.cache[stage.phase];
    const delta = (key) => cache?.after?.[key] - cache?.before?.[key];
    const samples = monitoring.samples.filter(
      (s) => s.phase === `menu-spike-${stage.phase}`,
    );
    const transition =
      stage.phase === 'sold-out-update' || stage.phase === 'available-update';
    const expected = transition
      ? menuSpikeProfile.clients + menuSpikeProfile.mutationReaders
      : stage.phase.endsWith('spike')
        ? menuSpikeProfile.clients
        : stage.phase === 'baseline'
          ? menuSpikeProfile.baselineRequests
          : menuSpikeProfile.recoveryRequests;
    const checks = {
      orderedStage: stage.phase === menuSpikeStages[i],
      completeTraffic:
        stage.requests === expected &&
        stage.samples.length === expected &&
        stage.samples.every((s) => s.ok && s.status === '200') &&
        stage.errorRate === 0,
      latency:
        stage.p95Ms !== null &&
        stage.p99Ms !== null &&
        stage.p95Ms <= menuSpikeProfile.p95Ms &&
        stage.p99Ms <= menuSpikeProfile.p99Ms,
      concurrentLaunch:
        !stage.phase.endsWith('spike') ||
        stage.launchSpreadMs <= menuSpikeProfile.maximumLaunchSpreadMs,
      tenantDistribution: transition
        ? JSON.stringify(stage.tenantCounts) === JSON.stringify([16, 8, 8])
        : stage.phase === 'mixed-spike' || stage.phase === 'detail-spike'
          ? stage.tenantCounts.every((n) => n === 8)
          : !stage.phase.endsWith('spike') ||
            stage.tenantCounts[2] === expected,
      criticalProbes:
        (!stage.phase.endsWith('spike') && !transition) ||
        ['cashier', 'health'].every((kind) =>
          stage.probes.some((p) => p.kind === kind && p.ok && p.ms <= 1000),
        ),
      monitoring:
        samples.length >= 2 &&
        samples.every((s) => s.database && s.api?.pool && s.process) &&
        samples
          .slice(1)
          .every((s, j) => s.elapsedMs - samples[j].elapsedMs <= 2000),
      coldSingleLoad:
        stage.phase !== 'cold-spike' ||
        (delta('misses') === 1 &&
          delta('hits') + delta('coalesced') === expected - 1),
      resourceBounds:
        samples.length > 0 &&
        samples.every(
          (s) =>
            s.api.pool.total <= s.api.pool.policy.max &&
            s.api.pool.waiting <= s.api.pool.policy.maxWaiting &&
            s.api.menuGate?.active <= 4 &&
            s.api.menuGate?.waiting <= 20 &&
            s.api.menuCache.inFlight <= 16 &&
            s.api.menuCache.bytes <= 8 * 1024 * 1024,
        ),
      warmCache:
        stage.phase !== 'warm-spike' ||
        (delta('hits') === expected && delta('misses') === 0),
      mixedCache:
        stage.phase !== 'mixed-spike' ||
        (delta('misses') === 3 &&
          delta('hits') + delta('coalesced') === expected - 3),
      cacheHealthy:
        delta('loadErrors') === 0 &&
        delta('bypassed') === 0 &&
        cache?.after?.inFlight === 0,
      detailCoverage:
        stage.phase !== 'detail-spike' ||
        (stage.samples.filter((s) => s.kind === 'detail').length === 12 &&
          stage.samples.filter((s) => s.kind === 'menu').length === 12),
      availabilityPropagated:
        !transition ||
        (cache?.revisionChanged === true &&
          cache.explicitlyCleared === false &&
          cache.before.entries > 0 &&
          delta('misses') >= 1 &&
          stage.samples.filter((s) => s.postCommit).length ===
            menuSpikeProfile.mutationReaders &&
          stage.samples
            .filter((s) => s.postCommit)
            .every(
              (s) =>
                s.ok &&
                s.expectedStatus ===
                  (stage.phase === 'sold-out-update'
                    ? 'SOLD_OUT'
                    : 'AVAILABLE'),
            )),
    };
    return {
      ...stage,
      checks,
      pass: Object.values(checks).every(Boolean),
      cacheDelta: Object.fromEntries(
        ['hits', 'misses', 'coalesced', 'loadErrors', 'bypassed'].map((k) => [
          k,
          delta(k),
        ]),
      ),
      resources: samples.length
        ? {
            samples: samples.length,
            peakCpuCoreEquivalent: Math.max(
              ...samples.map((s) => s.process.cpuCoreEquivalent),
            ),
            peakRssBytes: Math.max(...samples.map((s) => s.process.rssBytes)),
            peakDbConnections: Math.max(
              ...samples.map((s) => s.database.connections),
            ),
            peakPoolWaiting: Math.max(
              ...samples.map((s) => s.api.pool.waiting),
            ),
            peakMenuGateWaiting: Math.max(
              ...samples.map((s) => s.api.menuGate?.waiting ?? 0),
            ),
          }
        : null,
    };
  });
  const checks = {
    fixedProfile:
      JSON.stringify(workload.profile) === JSON.stringify(menuSpikeProfile),
    completeStages: stages.length === menuSpikeStages.length,
    successfulStages: stages.every((s) => s.pass),
    monitoringComplete:
      monitoring.sampleFailures === 0 && !monitoring.truncated,
    sessionsCleaned:
      workload.sessionsCreated === 1 && workload.sessionsRevoked === 1,
    boundedWrites:
      evidence.ordersUnchanged &&
      evidence.usersUnchanged &&
      evidence.sessionRows === 1 &&
      evidence.revokedRows === 1 &&
      evidence.availabilityRestored,
    availabilityRestored: workload.availabilityRestored === true,
    committedMutations:
      workload.mutations?.length === 2 &&
      workload.mutations.every(
        (m, i) =>
          m.ok &&
          m.status === '200' &&
          m.target === (i === 0 ? 'SOLD_OUT' : 'AVAILABLE') &&
          Number.isFinite(m.propagationMs) &&
          m.propagationMs <= menuSpikeProfile.propagationBudgetMs,
      ),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    evidence,
    profile: menuSpikeProfile,
    stages,
    limitations: [
      'Small local HTTP-only samples; p95/p99 are observations, not production SLO certification.',
      'Fixed 24-source bursts with limits active; higher traffic, browsers, CDN/assets and distributed instances need separate testing.',
      'Resource maxima are sampled. Cache reset uses an acknowledged private IPC barrier; no reset API is exposed.',
    ],
  };
}
