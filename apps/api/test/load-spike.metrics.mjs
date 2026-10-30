import { spikeProfile, spikeKinds } from './load-spike.workload.mjs';
import { evaluateSpikeOverload } from './load-spike.overload.mjs';

export function evaluateTrafficSpike(workload, monitoring, evidence) {
  const overload = evaluateSpikeOverload(
    workload.overload,
    evidence.protection,
    monitoring,
  );
  const stages = workload.stages.map((stage, i) => {
    const samples = monitoring.samples.filter(
      (s) => s.phase === `traffic-spike-${stage.phase}` && s.api,
    );
    const checks = {
      plan:
        stage.phase === spikeProfile.phases[i] &&
        stage.clients === spikeProfile.levels[i] &&
        stage.startDelayMs <= spikeProfile.dispatchDelayMs,
      completed:
        stage.requests === stage.clients * spikeProfile.seconds &&
        stage.successes === stage.requests &&
        stage.errorRate === 0 &&
        stage.missed === 0 &&
        stage.missedProbes === 0,
      latency:
        Number.isFinite(stage.p95Ms) &&
        stage.p95Ms <= spikeProfile.p95Ms &&
        Number.isFinite(stage.p99Ms) &&
        stage.p99Ms <= spikeProfile.p99Ms,
      waves:
        stage.waves.length === spikeProfile.seconds &&
        stage.waves.every(
          (w) =>
            w.started === stage.clients &&
            w.launchSpreadMs <= spikeProfile.launchSpreadMs &&
            w.maximumDispatchDelayMs <= spikeProfile.dispatchDelayMs,
        ),
      workflows: spikeKinds.every((kind) => {
        const s = stage.workflows[kind];
        return (
          s?.successes >= 4 &&
          s.errorRate === 0 &&
          s.p95Ms <= spikeProfile.p95Ms &&
          s.p99Ms <= spikeProfile.p99Ms
        );
      }),
      critical:
        stage.probes.length === spikeProfile.seconds * 3 &&
        stage.probes.every(
          (p) => p.ok && p.status === '200' && p.ms <= spikeProfile.criticalMs,
        ) &&
        ['cashier', 'kitchen', 'health'].every((kind) =>
          [0, 1, 2].every((tenant) =>
            stage.probes.some((p) => p.kind === kind && p.tenant === tenant),
          ),
        ),
      login:
        stage.login.length === 1 &&
        stage.login[0].ok &&
        stage.login[0].status === '200' &&
        stage.login[0].ms <= spikeProfile.criticalMs,
      monitored:
        samples.length >= 60 &&
        samples.at(-1).elapsedMs - samples[0].elapsedMs >= 7500 &&
        samples
          .slice(1)
          .every((s, j) => s.elapsedMs - samples[j].elapsedMs <= 1500) &&
        samples.every(
          (s) =>
            s.api.pool.total <= s.api.pool.policy.max &&
            s.api.pool.waiting <= s.api.pool.policy.maxWaiting &&
            s.database.connections <= s.api.pool.policy.max + 2,
        ),
    };
    return {
      ...stage,
      checks,
      pass: Object.values(checks).every(Boolean),
      resources: samples.length
        ? {
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
            samples: samples.length,
          }
        : null,
    };
  });
  const all = workload.stages.flatMap((s) => [
    ...s.samples,
    ...s.probes,
    ...s.login,
  ]);
  const checks = {
    profile: JSON.stringify(workload.profile) === JSON.stringify(spikeProfile),
    stages: stages.length === 3 && stages.every((s) => s.pass),
    bounded: workload.peakInFlight <= spikeProfile.maxInFlight,
    recovery:
      Number.isFinite(workload.recoverySpikeDrainMs) &&
      workload.recoverySpikeDrainMs <= spikeProfile.recoveryMs,
    monitoring: monitoring.sampleFailures === 0 && !monitoring.truncated,
    httpErrors:
      (monitoring.http.statusCounts['429'] ?? 0) ===
        (overload.throttled ?? 0) &&
      (monitoring.http.statusCounts['503'] ?? 0) === (overload.shed ?? 0) &&
      Object.entries(monitoring.http.statusCounts).every(
        ([status, count]) =>
          !(Number(status) >= 500 && status !== '503') || count === 0,
      ),
    overload: overload.pass,
    sessions:
      workload.sessionsCreated === 6 &&
      workload.sessionsRevoked === 6 &&
      evidence.sessions === 6 &&
      evidence.revoked === 6,
    writes: [
      'ordersUnchanged',
      'linesUnchanged',
      'usersUnchanged',
      'productsUnchanged',
      'paidUnchanged',
    ].every((key) => evidence[key] === true),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    overload: { ...overload, workload: workload.overload },
    stages,
    recoverySpikeDrainMs: workload.recoverySpikeDrainMs,
    peakDriverInFlight: workload.peakInFlight,
    protectionResponses: {
      throttled:
        all.filter((s) => s.status === '429').length +
        (overload.throttled ?? 0),
      shed: all.filter((s) => s.status === '503').length + (overload.shed ?? 0),
      unexpected: all.filter((s) => !s.ok && !['429', '503'].includes(s.status))
        .length,
    },
    evidence,
    limitations: [
      'Fixed local 12-fold offered-load jump; not a production capacity or breakpoint claim.',
      'Three owner identities authorize dashboards/cashier/kitchen probes; real loopback socket sources model distinct clients.',
      'One measured login per phase and four requests per baseline workflow are observed samples, not statistically reliable tail estimates.',
      'Read/login spike only; order write bursts and Supabase delivery have separate profiles.',
    ],
  };
}
