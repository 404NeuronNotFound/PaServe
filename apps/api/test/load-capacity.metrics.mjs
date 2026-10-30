import {
  capacityProfile as p,
  capacityConclusion,
  capacityStageVerdict,
} from './load-capacity.profile.mjs';

export function evaluateCapacity(workload, monitoring, evidence) {
  const stages = workload.stages.map((stage) => {
    const seconds = stage.role === 'headroom' ? p.headroomSeconds : p.seconds;
    const samples = monitoring.samples.filter(
      (s) => s.phase === stage.phase && s.api,
    );
    const max = (fn) => (samples.length ? Math.max(...samples.map(fn)) : null);
    const resources = {
      samples: samples.length,
      peakCpuCoreEquivalent: max((s) => s.process.cpuCoreEquivalent),
      peakDbCpuCoreEquivalent: max((s) => s.api.databaseCpu?.cores ?? NaN),
      peakRssBytes: max((s) => s.process.rssBytes),
      peakEventLoopP95Ms: max((s) => s.process.eventLoopP95Ms),
      peakClientConnections: max((s) => s.database.clientConnections),
      peakBackgroundConnections: max((s) => s.database.backgroundConnections),
      peakDbActive: max((s) => s.database.active),
      peakDbLockWaiters: max((s) => s.database.lock_waiters),
      peakPoolWaiting: max((s) => s.api.pool.waiting),
      peakApiActive: max((s) => s.api.capacity.active.total),
      peakMenuWaiting: max((s) => s.api.menuGate.waiting),
    };
    const monitored =
      samples.length >= seconds * 5 * 0.85 &&
      samples.at(-1).elapsedMs - samples[0].elapsedMs >= (seconds - 1) * 1000 &&
      samples
        .slice(1)
        .every((s, i) => s.elapsedMs - samples[i].elapsedMs <= 2000);
    const bounded =
      samples.length > 0 &&
      samples.every(
        (s) =>
          s.process.rssBytes <= p.resourceRssBytes &&
          s.process.heapUsedBytes <= 512 * 1024 * 1024 &&
          s.api.databaseCpu?.healthy === true &&
          Number.isFinite(s.api.databaseCpu.cores) &&
          s.api.databaseCpu.cores >= 0 &&
          s.api.databaseCpu.ageMs >= 0 &&
          s.api.databaseCpu.ageMs <= 3000 &&
          s.api.pool.total <= s.api.pool.policy.max &&
          s.api.pool.waiting <= s.api.pool.policy.maxWaiting &&
          Number.isInteger(s.database.clientConnections) &&
          s.database.clientConnections >= 0 &&
          s.database.clientConnections <= s.api.pool.policy.max + 3 &&
          Number.isInteger(s.database.backgroundConnections) &&
          s.database.backgroundConnections >= 0 &&
          s.database.activityBackends ===
            s.database.clientConnections + s.database.backgroundConnections,
      );
    return {
      ...stage,
      verdict: capacityStageVerdict(stage),
      resources,
      monitored,
      bounded,
    };
  });
  const levels = stages.filter((s) => s.role === 'level');
  const confirmation = stages.filter((s) => s.role === 'confirmation');
  const recovery = stages.filter((s) => s.role === 'recovery');
  const headroom = stages.filter((s) => s.role === 'headroom');
  const conclusion = capacityConclusion(stages);
  const events = evidence.attribution?.events ?? [];
  const validEvents =
    events.length > 0 &&
    events.every(
      (e, i) =>
        Number.isInteger(e.sequence) &&
        e.sequence > 0 &&
        (i === 0 || e.sequence > events[i - 1].sequence) &&
        Number.isFinite(e.elapsedMs) &&
        e.elapsedMs >= 0 &&
        Number.isInteger(e.count) &&
        e.count > 0 &&
        [
          'IP-route-rate-limit',
          'tenant-account-fairness',
          'API-admission',
          'public-menu-gate',
          'DB-connection-pool',
        ].includes(e.component) &&
        stages.some((s) => s.phase === e.phase),
    );
  const firstFailure = levels.find((s) => !s.verdict.sloPass);
  const firstLimiter =
    events.find((e) => e.phase === firstFailure?.phase) ?? null;
  const headroomPass =
    headroom.length === 1 &&
    headroom[0].offeredRps === conclusion.candidatePlanningRps &&
    headroom[0].monitored &&
    headroom[0].bounded &&
    headroom[0].seconds === p.headroomSeconds &&
    headroom[0].verdict.sloPass &&
    headroom[0].failures === 0 &&
    headroom[0].missedScheduledRequests === 0 &&
    headroom[0].windows?.length === p.headroomSeconds / p.seconds &&
    headroom[0].windows.every(
      (w, i) =>
        w.index === i &&
        w.requests === headroom[0].offeredRps * p.seconds &&
        w.successes === w.requests &&
        w.missedScheduledRequests === 0 &&
        Number.isFinite(w.p95Ms) &&
        w.p95Ms <= p.p95Ms &&
        Number.isFinite(w.p99Ms) &&
        w.p99Ms <= p.p99Ms,
    ) &&
    !events.some((e) => e.phase === headroom[0].phase);
  const idleSamples = monitoring.samples.filter(
    (s) => s.phase === 'capacity-idle' && s.api,
  );
  const idle = idleSamples.at(-1);
  const failedIndex = levels.findIndex((s) => !s.verdict.sloPass);
  const checks = {
    profile: JSON.stringify(workload.profile) === JSON.stringify(p),
    complete:
      workload.complete === true &&
      levels.length >= 1 &&
      levels.length <= p.levels.length &&
      levels.every(
        (s, i) =>
          s.offeredRps === p.levels[i] && s.phase === `capacity-level-${i}`,
      ) &&
      (failedIndex < 0
        ? levels.length === p.levels.length && confirmation.length === 0
        : failedIndex === levels.length - 1 &&
          confirmation.length === 1 &&
          confirmation[0].phase === `capacity-confirmation-${failedIndex}`) &&
      recovery.length === 1 &&
      recovery[0].offeredRps === p.levels[0] &&
      headroom.length === 1 &&
      stages.at(-1) === headroom[0] &&
      stages.indexOf(recovery[0]) === stages.length - 2,
    baseline: levels[0]?.verdict.sloPass === true,
    measured: stages.every(
      (s) =>
        s.verdict.valid && !s.verdict.unexpected && s.invalidRetryAfter === 0,
    ),
    monitoring:
      monitoring.sampleFailures === 0 &&
      !monitoring.truncated &&
      stages.every((s) => s.monitored && s.bounded),
    discovery:
      conclusion.firstFailingOfferedRps === null || conclusion.confirmed,
    firstLimiter:
      evidence.attribution?.truncated === false &&
      validEvents &&
      !!firstLimiter,
    headroom: headroomPass,
    health: stages.every((s) =>
      s.probes
        .filter((v) => v.kind === 'health')
        .every((v) => v.ok && v.ms <= p.p95Ms),
    ),
    recovery:
      recovery.length === 1 &&
      recovery[0].verdict.sloPass &&
      recovery[0].probes.every((v) => v.ok && v.ms <= p.p95Ms),
    driverBound: workload.peakInFlight <= p.maxInFlight,
    idle:
      !!idle &&
      idleSamples.length >= p.idleSeconds * 5 * 0.85 &&
      idle.elapsedMs - idleSamples[0].elapsedMs >= (p.idleSeconds - 1) * 1000 &&
      idle.api.pool.total === 0 &&
      idle.api.pool.waiting === 0 &&
      idle.api.pool.pendingCheckouts === 0 &&
      idle.api.pool.acquired === idle.api.pool.released &&
      idle.api.capacity.active.total === 0 &&
      idle.api.fairness.activeScopeLeases === 0 &&
      idle.api.menuGate.active === 0 &&
      idle.api.menuGate.waiting === 0 &&
      idle.network.activeConnections === 0 &&
      idle.database.clientConnections <= 3,
    controls:
      workload.controls.length >= 6 &&
      workload.controls.every((s) => s.ok && s.ms <= p.p99Ms) &&
      workload.sessionsCreated === 3 &&
      workload.sessionsRevoked === 3 &&
      evidence.sessions === 3 &&
      evidence.revoked === 3,
    writes: [
      'ordersUnchanged',
      'linesUnchanged',
      'usersUnchanged',
      'productsUnchanged',
      'paidUnchanged',
    ].every((k) => evidence[k] === true),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    conclusion,
    attribution: {
      ...evidence.attribution,
      firstAcrossRamp: events[0] ?? null,
      firstAtFailedLevel: firstLimiter,
      scope:
        'First observed protection/component rejection on one API clock; not proof of an unexercised hardware bottleneck.',
    },
    operatingHeadroom: {
      validated: headroomPass,
      readsPerSecond: headroomPass ? headroom[0].offeredRps : null,
      testedSeconds: headroom[0]?.seconds ?? 0,
      reserveBelowLastPassingPercent: headroomPass
        ? (1 - headroom[0].offeredRps / conclusion.lastPassingOfferedRps) * 100
        : null,
      scope:
        'Validated local mixed-read operating target for this profile and duration; deployment sizing requires its own run.',
    },
    stages,
    quiescent: idle
      ? {
          pool: idle.api.pool,
          clients: idle.database.clientConnections,
          background: idle.database.backgroundConnections,
        }
      : null,
    evidence,
    workload,
    guidance:
      conclusion.classification === 'policy-throttling'
        ? 'The measured boundary includes existing IP/account/shop policy. Review the traffic distribution and rejection codes before changing quotas; more API instances alone do not establish a higher safe policy ceiling.'
        : conclusion.classification === 'load-shedding'
          ? 'Inspect API/menu admission and DB wait peaks at the boundary. Retest one change at a time with the same dataset, pool and traffic mix.'
          : 'Use stage CPU, event-loop, pool waits and per-workflow latency to choose the next experiment. A bounded lower limit is not a proven hardware ceiling.',
    limitations: [
      'Single local API and owned PostgreSQL, four read workflows, three owner identities/shops and at most 48 loopback source IPs; not concurrent human-user capacity.',
      'Short plateaus and inherited bucket history describe this exact ramp; they do not establish sustained throughput or statistically reliable p99 at low rates.',
      'A confirmation repeats the failing level in the same fixture; independent-run reproducibility and deployment-specific capacity remain separate checks.',
      'Headroom is validated only for the recorded sustained duration, fixture and traffic distribution; not a deployment sizing or autoscaling threshold.',
      'Owned PostgreSQL CPU is sampled from live process counters once per second; CPU between worker creation/exit and sampling can be missed. Realtime and WAN bottlenecks are outside this read profile.',
    ],
  };
}
