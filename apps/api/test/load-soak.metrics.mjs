import {
  soakProfile,
  soakKinds,
  expectedSoakSessions,
  expectedSoakRefreshes,
} from './load-soak.profile.mjs';
import { cleanSoakLogs } from './load-soak.logs.mjs';
const MiB = 1024 * 1024;
const quantile = (values, p) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.max(0, Math.ceil(v.length * p) - 1)] : null;
};
export function robustSlope(points) {
  const slopes = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (points[j].minute > points[i].minute)
        slopes.push(
          (points[j].value - points[i].value) /
            (points[j].minute - points[i].minute),
        );
  return quantile(slopes, 0.5);
}
export function memoryTrend(rows, key, threshold, deltaFloor) {
  const points = rows.map((r) => ({ minute: r.minute, value: r[key] })),
    n = Math.min(3, Math.floor(points.length / 2));
  if (n < 1) return { sufficient: false, suspected: false };
  const first = quantile(
      points.slice(0, n).map((p) => p.value),
      0.5,
    ),
    last = quantile(
      points.slice(-n).map((p) => p.value),
      0.5,
    );
  const slope = robustSlope(points),
    lateSlope = robustSlope(points.slice(Math.floor(points.length / 2)));
  return {
    first,
    last,
    delta: last - first,
    slopePerMinute: slope,
    lateSlopePerMinute: lateSlope,
    suspected:
      slope > threshold && lateSlope > threshold && last - first > deltaFloor,
  };
}
export function analyzeSoakMemory(rows) {
  return {
    heap: memoryTrend(rows, 'heapLow', 0.5 * MiB, 16 * MiB),
    rss: memoryTrend(rows, 'rssLow', 2 * MiB, 64 * MiB),
    external: memoryTrend(rows, 'externalLow', 0.25 * MiB, 8 * MiB),
    sockets: memoryTrend(rows, 'socketLow', 0.1, 2),
    timers: memoryTrend(rows, 'timerLow', 5, 100),
  };
}
export function evaluateSoak(workload, monitoring, evidence) {
  const p = soakProfile(workload.profile.name),
    measured = workload.windows.filter((w) =>
      w.phase.startsWith('soak-window-'),
    );
  const resources = measured.map((window) => {
    const samples = monitoring.samples.filter(
      (s) => s.phase === window.phase && s.api,
    );
    return {
      phase: window.phase,
      samples: samples.length,
      spanMs: samples.length
        ? samples.at(-1).elapsedMs - samples[0].elapsedMs
        : 0,
      minute: quantile(
        samples.map((s) => s.elapsedMs / 60000),
        0.5,
      ),
      heapLow: quantile(
        samples.map((s) => s.process.heapUsedBytes),
        0.1,
      ),
      rssLow: quantile(
        samples.map((s) => s.process.rssBytes),
        0.1,
      ),
      externalLow: quantile(
        samples.map((s) => s.process.externalBytes),
        0.1,
      ),
      socketLow: quantile(
        samples.map((s) => s.api.soakResources?.TCPSocketWrap ?? 0),
        0.1,
      ),
      timerLow: quantile(
        samples.map((s) => s.api.soakResources?.Timeout ?? 0),
        0.1,
      ),
    };
  });
  const memory = analyzeSoakMemory(resources),
    longEnough = p.windows * p.windowSeconds >= 600;
  const cooldown = monitoring.samples.filter(
      (s) => s.phase === 'soak-cooldown' && s.api,
    ),
    idle = cooldown.at(-1);
  const steady = monitoring.samples.filter(
    (s) => s.phase.startsWith('soak-window-') && s.api,
  );
  const degraded = soakKinds.filter((kind) => {
    const values = measured.map((w) => w.byKind[kind].p95Ms),
      first = quantile(values.slice(0, 3), 0.5),
      last = quantile(values.slice(-3), 0.5);
    return longEnough && last > Math.max(first * 2, first + 50);
  });
  const checks = {
    logs:
      cleanSoakLogs(evidence.logs) &&
      steady.length > 0 &&
      steady.every((s) => cleanSoakLogs(s.api.soakLogs)),
    profile: JSON.stringify(workload.profile) === JSON.stringify(p),
    complete:
      workload.complete === true &&
      workload.windows.length === p.windows + 1 &&
      measured.length === p.windows &&
      new Set(measured.map((w) => w.phase)).size === p.windows,
    workload:
      workload.missed === 0 &&
      workload.peakInFlight <= p.maxInFlight &&
      workload.windows.every(
        (w) =>
          w.requests === w.seconds * 6 &&
          w.successes === w.requests &&
          w.errorRate === 0 &&
          w.missed === 0 &&
          soakKinds.every(
            (kind) =>
              w.byKind[kind]?.requests === w.seconds &&
              w.byKind[kind].successes === w.seconds &&
              w.byKind[kind].errorRate === 0 &&
              Number.isFinite(w.byKind[kind].p95Ms) &&
              Number.isFinite(w.byKind[kind].p99Ms) &&
              w.byKind[kind].p95Ms <= p.p95Ms &&
              w.byKind[kind].p99Ms <= p.p99Ms,
          ) &&
          w.byKind.health?.successes >= Math.floor(w.seconds / 5) &&
          w.byKind.health.errorRate === 0,
      ),
    controls:
      workload.controls.length > 0 &&
      workload.controls.every((s) => s.ok && s.ms <= p.p99Ms) &&
      workload.refreshes === expectedSoakRefreshes(p) &&
      workload.sessionsCreated === expectedSoakSessions(p) &&
      workload.sessionsRevoked === workload.sessionsCreated,
    monitored:
      resources.every(
        (r) =>
          r.samples >= p.windowSeconds * 0.85 &&
          r.spanMs >= (p.windowSeconds - 3) * 1000,
      ) &&
      monitoring.sampleFailures === 0 &&
      steady.every(
        (s) => s.api.soakResources && typeof s.api.soakResources === 'object',
      ) &&
      !monitoring.truncated &&
      steady
        .slice(1)
        .every((s, i) => s.elapsedMs - steady[i].elapsedMs <= 3000),
    bounded:
      steady.length > 0 &&
      steady.every(
        (s) =>
          s.process.rssBytes <= p.maxRssBytes &&
          s.process.heapUsedBytes <= p.maxHeapBytes &&
          s.process.externalBytes <= p.maxExternalBytes &&
          s.api.pool.total <= s.api.pool.policy.max &&
          s.api.pool.waiting <= s.api.pool.policy.maxWaiting &&
          Number.isInteger(s.database.clientConnections) &&
          s.database.clientConnections >= 0 &&
          s.database.clientConnections <= s.api.pool.policy.max + 3 &&
          Number.isInteger(s.database.backgroundConnections) &&
          s.database.backgroundConnections >= 0 &&
          s.database.activityBackends ===
            s.database.clientConnections + s.database.backgroundConnections,
      ),
    memory:
      !longEnough || Object.values(memory).every((t) => t.suspected === false),
    performance: degraded.length === 0,
    idle:
      !!idle &&
      cooldown.at(-1).elapsedMs - cooldown[0].elapsedMs >=
        (p.cooldownSeconds - 3) * 1000 &&
      idle.api.pool.total === 0 &&
      idle.api.pool.waiting === 0 &&
      idle.api.pool.pendingCheckouts === 0 &&
      idle.api.pool.acquired === idle.api.pool.released &&
      idle.api.capacity.active.total === 0 &&
      idle.api.fairness.activeScopeLeases === 0 &&
      idle.api.menuGate.active === 0 &&
      idle.api.menuGate.waiting === 0 &&
      idle.api.passwords.active === 0 &&
      idle.network.activeConnections === 0 &&
      idle.database.clientConnections <= 3,
    writes:
      evidence.ordersUnchanged &&
      evidence.linesUnchanged &&
      evidence.usersUnchanged &&
      evidence.productsUnchanged &&
      evidence.paidUnchanged &&
      evidence.sessions === workload.sessionsCreated &&
      evidence.revoked === workload.sessionsRevoked,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    profile: p,
    scope: longEnough
      ? 'sustained local soak'
      : 'smoke verification only; too short for leak trends',
    resources,
    memory,
    logs: evidence.logs,
    degradedWorkflows: degraded,
    workload,
    quiescent: idle
      ? {
          pool: idle.api.pool,
          connections: idle.database.connections,
          clientConnections: idle.database.clientConnections,
          backgroundConnections: idle.database.backgroundConnections,
          activeRequests: idle.api.capacity.active.total,
          activeSockets: idle.network.activeConnections,
          resources: idle.api.soakResources,
        }
      : null,
    limitations: [
      'No forced GC; lower-envelope growth is a leak suspicion signal, not proof of its cause.',
      'API and resource collector share one process; collector retention contributes small known growth.',
      'Local read/auth/session churn only; hosted Supabase, SSE, order-write growth and multi-host behavior need separate sustained tests.',
    ],
  };
}
