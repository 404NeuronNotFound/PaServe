import assert from 'node:assert/strict';

// Fixed local planning profile; inherited LOAD_* settings cannot increase load.
export const rampProfile = Object.freeze({
  levels: Object.freeze([2, 4, 6, 8]),
  stageSeconds: 45,
  menuEveryMs: 1000,
  statusEveryMs: 5000,
  dashboardEveryMs: 15000,
  searchEveryMs: 1000,
  pollEveryMs: 5000,
  p95Ms: 1000,
  p99Ms: 1500,
  maximumErrorRate: 0.01,
  maximumMissedRate: 0.01,
  minimumSamples: 100,
});

export const rampDiagnosticProfile = Object.freeze({
  ...rampProfile,
  levels: Object.freeze([2, 4, 8, 16, 32, 64]),
});

export function analyzeRampDegradation(stages) {
  const workflows = ['menu', 'dashboard', 'order-status'];
  const findings = [];
  for (const kind of workflows) {
    const comparable = stages.filter(
      (s) =>
        s.byWorkflow?.[kind]?.successes >= 30 &&
        s.byWorkflow[kind].errorRate <= 0.01,
    );
    const baseline = comparable[0];
    if (!baseline) continue;
    const threshold = Math.max(
      baseline.byWorkflow[kind].p95Ms * 1.5,
      baseline.byWorkflow[kind].p95Ms + 10,
    );
    for (let i = 1; i + 1 < comparable.length; i++) {
      const a = comparable[i],
        b = comparable[i + 1];
      const ai = stages.indexOf(a);
      if (
        stages[ai + 1] === b &&
        a.byWorkflow[kind].p95Ms >= threshold &&
        b.byWorkflow[kind].p95Ms >= threshold
      ) {
        findings.push({
          workflow: kind,
          virtualClients: a.virtualClients,
          confirmedAtVirtualClients: b.virtualClients,
          baselineP95Ms: baseline.byWorkflow[kind].p95Ms,
          thresholdP95Ms: threshold,
        });
        break;
      }
    }
  }
  const limited = stages.find((s) =>
    Object.entries(s.statusCounts ?? {}).some(
      ([code, count]) => ['429', '503'].includes(code) && count > 0,
    ),
  );
  const onset = findings.sort((a, b) => a.virtualClients - b.virtualClients)[0];
  return {
    latencyOnset: onset ?? null,
    findings,
    firstProtectionLimitedVirtualClients: limited?.virtualClients ?? null,
    conclusion: onset
      ? 'Sustained relative latency increase observed; inspect per-workflow resources and samples.'
      : limited
        ? 'Protection limits reached before a sustained latency onset was established.'
        : 'No sustained latency onset observed within the bounded tested range.',
    rule: 'Per workflow: at least 30 successes per stage, <=1% errors, p95 >= max(1.5x initial comparable p95, initial p95+10ms), confirmed at the next consecutive stage. Login has only one sample per plateau and cannot establish tail latency.',
  };
}

export function summarizeRamp(workload, monitoring, profile = rampProfile) {
  const stages = workload.stages.map((stage, index) => {
    assert.equal(
      stage.virtualClients,
      profile.levels[index],
      'Unexpected ramp stage.',
    );
    const samples = monitoring.samples.filter(
      (s) => s.phase === `ramp-${stage.virtualClients}`,
    );
    assert.ok(samples.length >= 3, 'Missing ramp stage resource samples.');
    assert.ok(
      samples.at(-1).elapsedMs - samples[0].elapsedMs >=
        (profile.stageSeconds - 2) * 1000,
      'Incomplete ramp stage monitoring.',
    );
    assert.ok(
      samples.slice(1).every((sample, i) => {
        const gap = sample.elapsedMs - samples[i].elapsedMs;
        return gap > 0 && gap <= 2000;
      }),
      'Ramp monitoring has a gap exceeding two seconds.',
    );
    const max = (fn) => Math.max(...samples.map(fn));
    const first = samples[0],
      last = samples.at(-1);
    const delta = (fn) => fn(last) - fn(first);
    const reasons = [];
    for (const kind of ['menu', 'login', 'dashboard', 'order-status']) {
      const stats = stage.byWorkflow?.[kind];
      if (!stats || stats.requests < 1 || stats.successes < 1)
        reasons.push(`missing successful ${kind} traffic`);
      else if (
        !Number.isFinite(stats.p95Ms) ||
        !Number.isFinite(stats.p99Ms) ||
        stats.p95Ms > profile.p95Ms ||
        stats.p99Ms > profile.p99Ms ||
        !(stats.errorRate <= profile.maximumErrorRate) ||
        !(stats.missedRate <= profile.maximumMissedRate)
      )
        reasons.push(`${kind} budget exceeded`);
    }
    if (!stage.sloPass) reasons.push('workload budget exceeded');
    if (!stage.sampleSufficient || stage.requests < rampProfile.minimumSamples)
      reasons.push('insufficient samples');
    if (stage.elapsedSeconds < rampProfile.stageSeconds)
      reasons.push('stage ended early');
    if (!(stage.p95Ms !== null && stage.p95Ms <= rampProfile.p95Ms))
      reasons.push('p95 latency');
    if (!(stage.p99Ms !== null && stage.p99Ms <= rampProfile.p99Ms))
      reasons.push('p99 latency');
    if (!(stage.errorRate <= rampProfile.maximumErrorRate))
      reasons.push('error rate');
    if (!(stage.missedRate <= rampProfile.maximumMissedRate))
      reasons.push('missed requests');
    const result = {
      ...stage,
      pass: reasons.length === 0,
      reasons,
      resources: {
        samples: samples.length,
        peakCpuCoreEquivalent: max((s) => s.process.cpuCoreEquivalent),
        peakRssBytes: max((s) => s.process.rssBytes),
        peakEventLoopP95Ms: max((s) => s.process.eventLoopP95Ms),
        peakDatabaseConnections: max((s) => s.database.connections),
        peakDatabaseActive: max((s) => s.database.active),
        peakLockWaiters: max((s) => s.database.lock_waiters),
        peakPoolTotal: max((s) => s.api.pool.total),
        peakPoolWaiting: max((s) => s.api.pool.waiting),
        peakPoolPendingCheckouts: max((s) => s.api.pool.pendingCheckouts),
        peakApiActive: max((s) => s.api.capacity.active.total),
        poolRejections: delta((s) => s.api.pool.rejected),
        capacityRejections: delta((s) =>
          Object.values(s.api.capacity.rejected).reduce((a, b) => a + b, 0),
        ),
        fairnessRejections: delta(
          (s) =>
            s.api.fairness.rateRejected +
            s.api.fairness.concurrencyRejected +
            s.api.fairness.capacityRejected,
        ),
        receivedBytes: delta((s) => s.network.receivedBytes),
        sentBytes: delta((s) => s.network.sentBytes),
      },
    };
    assert.ok(
      Object.values(result.resources).every(
        (value) => Number.isFinite(value) && value >= 0,
      ),
      'Missing or invalid ramp resource measurements.',
    );
    return result;
  });
  const completed = stages.length === profile.levels.length;
  const sessionsCleaned =
    workload.testSessionsCreated > 0 &&
    workload.testSessionsCreated === workload.testSessionsRevoked;
  return {
    profile,
    degradation: analyzeRampDegradation(stages),
    shape: 'stepped ramp; independently staggered clients at each plateau',
    pass: completed && sessionsCleaned && stages.every((s) => s.pass),
    completed,
    sessionsCleaned,
    firstFailingVirtualClients:
      stages.find((s) => !s.pass)?.virtualClients ?? null,
    highestPassingVirtualClients:
      stages.filter((s) => s.pass).at(-1)?.virtualClients ?? null,
    identities: workload.identities,
    shops: workload.shops,
    stages,
    limitations: [
      'Mixed HTTP menu, login, sales dashboard and customer status workload; not browser rendering or production capacity.',
      'Virtual clients share three identities and one source IP; normal protection policies remain active.',
      'No separate warm-up. Earlier plateaus warm the API/cache before later plateaus.',
      'Resource peaks are sampled, not absolute peaks; byte/counter deltas span the first and last samples inside each stage.',
    ],
  };
}
