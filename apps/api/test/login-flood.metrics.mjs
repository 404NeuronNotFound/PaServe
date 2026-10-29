import {
  loginFloodProfile,
  loginFloodAttemptCount,
} from './login-flood.workload.mjs';
import { summarizeTimes } from './password-login-flood.metrics.mjs';

export function evaluateLoginFlood(workload, monitoring, evidence) {
  const samples = monitoring.samples.filter(
    (s) => s.phase === 'login-flood-attack',
  );
  const count = (status) =>
    workload.attack.filter((s) => s.status === status).length;
  const timing = workload.metrics;
  const priorTargetFailures = (sample) =>
    workload.attack.filter(
      (s) =>
        s.priming &&
        s.status === '401' &&
        s.attackOffsetMs + s.ms <= sample.attackOffsetMs,
    ).length;
  const probeLatencyByKind = Object.fromEntries(
    ['menu', 'session', 'health'].map((kind) => [
      kind,
      summarizeTimes(
        workload.probes.filter((s) => s.kind === kind).map((s) => s.ms),
      ),
    ]),
  );
  const checks = {
    fixedProfile:
      JSON.stringify(workload.profile) === JSON.stringify(loginFloodProfile),
    continuousAttack:
      workload.attack.length === loginFloodAttemptCount() &&
      workload.attackElapsedMs >= 29900 &&
      workload.missedAttack === 0,
    boundedRejections:
      workload.attack.every(
        (s) =>
          ['401', '403', '429'].includes(s.status) &&
          s.code ===
            {
              401: 'INVALID_CREDENTIALS',
              403: 'BOT_CHALLENGE_REQUIRED',
              429: 'RATE_LIMIT_EXCEEDED',
            }[s.status] &&
          s.noSession,
      ) &&
      count('401') > 0 &&
      count('403') > 0 &&
      count('429') > 0,
    challengeRequired: workload.attack
      .filter((s) => s.status === '403')
      .every((s) => s.code === 'BOT_CHALLENGE_REQUIRED' && s.noStore),
    retryPolicy: workload.attack
      .filter((s) => s.status === '429')
      .every(
        (s) =>
          Number.isInteger(s.retryAfter) &&
          s.retryAfter > 0 &&
          s.retryAfter <= 900 &&
          s.noStore,
      ),
    legitimateLogins: ['baseline', 'legitimate', 'recovery'].every(
      (kind) =>
        workload[kind].length === 3 &&
        workload[kind].every((s) => s.ok) &&
        timing[kind].p95Ms <= loginFloodProfile.loginP95Ms,
    ),
    targetedVictimAccess:
      workload.victimDuring.length === 3 &&
      workload.victimDuring.every((s) => s.ok) &&
      timing.victimDuring.p95Ms <= loginFloodProfile.loginP95Ms &&
      workload.victimFreshSource.length === 1 &&
      workload.victimFreshSource[0].ok &&
      timing.victimFreshSource.p95Ms <= loginFloodProfile.loginP95Ms &&
      evidence.victimUnchanged &&
      evidence.victimSessionRows === 7,
    priorAccountThresholdExceeded:
      workload.attack.filter((s) => s.priming).length ===
        loginFloodProfile.clients &&
      workload.attack
        .filter((s) => s.priming)
        .every((s) => s.status === '401') &&
      loginFloodProfile.clients > 20,
    multipleVirtualClients:
      new Set(workload.attack.map((s) => s.client)).size ===
        loginFloodProfile.clients &&
      evidence.distinctAttackSources === loginFloodProfile.clients,
    victimAfterThresholds:
      workload.victimDuring.some((s) => s.ok && priorTargetFailures(s) >= 5) &&
      workload.victimDuring.some((s) => s.ok && priorTargetFailures(s) >= 20) &&
      workload.victimFreshSource.some(
        (s) => s.ok && priorTargetFailures(s) >= 20,
      ),
    healthyOperations:
      workload.missedProbes === 0 &&
      ['menu', 'session', 'health'].every(
        (kind) =>
          workload.probes.filter((s) => s.kind === kind).length >= 30 &&
          workload.probes.filter((s) => s.kind === kind).every((s) => s.ok) &&
          probeLatencyByKind[kind].p95Ms <= loginFloodProfile.probeP95Ms,
      ) &&
      timing.probes.p95Ms <= loginFloodProfile.probeP95Ms,
    sharedSourcePolicyExplicit:
      workload.sharedSource.length === 1 &&
      workload.sharedSource[0].status === '429',
    actualSocketIsolation:
      evidence.peers.attacker >= loginFloodAttemptCount() &&
      evidence.peers.legitimate >= 7 &&
      evidence.peers.other === 0,
    hashingBounded:
      samples.length >= 100 &&
      samples.every(
        (s) =>
          s.api.passwords.active <= s.api.passwords.maxConcurrent &&
          s.api.passwords.reservedKiB <= s.api.passwords.memoryBudgetKiB,
      ) &&
      samples.some(
        (s) => s.api.passwords.active > 0 && s.process.cpuCoreEquivalent > 0,
      ),
    hashWorkMeasured:
      evidence.targetAccountReads - evidence.victimSessionRows ===
        loginFloodProfile.clients &&
      evidence.hashVerifyJobs ===
        workload.sessionsCreated + loginFloodProfile.clients,
    noFailedLoginWrites:
      evidence.attackerSessions === 0 &&
      evidence.attackerUnchanged &&
      evidence.usersUnchanged &&
      evidence.sessionRows === workload.sessionsCreated &&
      evidence.revokedRows === workload.sessionsRevoked,
    sessionsCleaned:
      workload.sessionsCreated === 13 && workload.sessionsRevoked === 13,
    noExternalCalls: evidence.externalCallsDuringWorkload === 0,
    completeMonitoring:
      monitoring.sampleFailures === 0 &&
      !monitoring.truncated &&
      samples.at(-1)?.elapsedMs - samples[0]?.elapsedMs >= 29000 &&
      samples
        .slice(1)
        .every((s, i) => s.elapsedMs - samples[i].elapsedMs <= 2000),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    attackerStatusCounts: Object.fromEntries(
      ['401', '403', '429'].map((status) => [status, count(status)]),
    ),
    attackerResponseLatency: summarizeTimes(workload.attack.map((s) => s.ms)),
    probeLatencyByKind,
    metrics: timing,
    evidence,
    limitations: [
      'Twenty-four synthetic abusive source sockets and independent legitimate sources; not an internet botnet or shared-NAT fairness guarantee.',
      'Challenge escalation is enabled, but no challenge token is submitted. External provider verification, replay and outage handling are separate tests.',
      'Three sign-ins in each phase have small tail-latency samples; no deployment-capacity claim.',
      'Database row/state checks cover failed-login user/session writes; API logger is disabled in the owned harness, so production log pipelines are not certified.',
    ],
  };
}
