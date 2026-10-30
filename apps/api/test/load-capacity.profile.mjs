export const capacityProfile = Object.freeze({
  version: 2,
  levels: Object.freeze([4, 8, 16, 32, 64, 128, 256]),
  seconds: 30,
  headroomSeconds: 180,
  warmSeconds: 6,
  recoveryWaitSeconds: 61,
  idleSeconds: 15,
  maxInFlight: 128,
  probeReserve: 8,
  dispatchDelayMs: 150,
  requestMs: 3000,
  p95Ms: 1000,
  p99Ms: 1500,
  errorRate: 0.01,
  missedRate: 0.01,
  resourceRssBytes: 1024 * 1024 * 1024,
});
export const capacityKinds = Object.freeze([
  'menu',
  'product',
  'order-status',
  'dashboard',
]);

export function capacityStageVerdict(stage) {
  const p = capacityProfile;
  const seconds = stage.role === 'headroom' ? p.headroomSeconds : p.seconds;
  const reasons = [];
  if (stage.errorRate > p.errorRate) reasons.push('responses');
  if (stage.missedRate > p.missedRate) reasons.push('driver-schedule');
  if (stage.p95Ms > p.p95Ms || stage.p99Ms > p.p99Ms) reasons.push('latency');
  if (stage.probes.some((s) => !s.ok || s.ms > p.p95Ms))
    reasons.push('critical-path');
  const accounted =
    stage.requests + stage.missedScheduledRequests ===
    stage.offeredRps * seconds;
  const valid =
    accounted &&
    stage.requests > 0 &&
    ((Number.isFinite(stage.p95Ms) && Number.isFinite(stage.p99Ms)) ||
      (stage.successes === 0 &&
        stage.p95Ms === null &&
        stage.p99Ms === null)) &&
    capacityKinds.every((kind) => stage.byKind[kind]?.requests >= 30) &&
    stage.probes.length === seconds * 3 &&
    ['health', 'cashier', 'kitchen'].every(
      (kind) =>
        stage.probes.filter((v) => v.kind === kind).length === seconds &&
        [0, 1, 2].every((tenant) =>
          stage.probes.some((v) => v.kind === kind && v.tenant === tenant),
        ),
    ) &&
    stage.probes.every((v) => Number.isFinite(v.ms) && v.ms >= 0) &&
    stage.missedProbes === 0;
  const unexpected =
    stage.probes.some((s) => !['200', '429', '503'].includes(s.status)) ||
    Object.entries(stage.statusCounts).some(
      ([status, count]) => count > 0 && !['200', '429', '503'].includes(status),
    );
  return {
    valid,
    unexpected,
    sloPass: valid && !unexpected && reasons.length === 0,
    reasons,
  };
}

export function capacityConclusion(stages) {
  const levels = stages.filter((s) => s.role === 'level');
  const lastPassing = levels
    .filter((s) => capacityStageVerdict(s).sloPass)
    .at(-1);
  const firstFailing = levels.find((s) => !capacityStageVerdict(s).sloPass);
  const confirmation = stages.find((s) => s.role === 'confirmation');
  const confirmed =
    !!firstFailing &&
    !!confirmation &&
    confirmation.offeredRps === firstFailing.offeredRps &&
    !capacityStageVerdict(confirmation).sloPass &&
    !capacityStageVerdict(firstFailing).unexpected &&
    !capacityStageVerdict(confirmation).unexpected &&
    capacityStageVerdict(firstFailing).valid &&
    capacityStageVerdict(confirmation).valid &&
    !capacityStageVerdict(firstFailing).reasons.includes('driver-schedule') &&
    !capacityStageVerdict(confirmation).reasons.includes('driver-schedule');
  const status = firstFailing?.statusCounts ?? {};
  return {
    lastPassingOfferedRps: lastPassing?.offeredRps ?? null,
    firstFailingOfferedRps: firstFailing?.offeredRps ?? null,
    confirmed,
    classification: !firstFailing
      ? 'bounded-range-lower-bound'
      : !confirmed
        ? 'unconfirmed-or-driver-limited'
        : (status['429'] ?? 0) > 0
          ? 'policy-throttling'
          : (status['503'] ?? 0) > 0
            ? 'load-shedding'
            : 'latency-budget',
    candidatePlanningRps:
      confirmed && lastPassing
        ? Math.floor(lastPassing.offeredRps * 0.7)
        : null,
  };
}
