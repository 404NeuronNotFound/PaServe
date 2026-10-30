// Offline, read-only verification of the user's five criteria from archived runs.
// A combined criteria verdict never rewrites a failed/incomplete run as passing.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const priorPath = 'baselines/2026-10-30-soak-multi-hour-v1-diagnostic.json';
const targetedPath = 'baselines/2026-10-30-soak-classified-smoke-v2.json';
const shortenedPath = 'baselines/2026-10-30-soak-multi-hour-v2-user-shortened.json';
const prior = await read(priorPath), targeted = await read(targetedPath), shortened = await read(shortenedPath);
const e = prior.environment, w = prior.workload, t = targeted.environment;
assert.equal(e.runId, w.runId);
assert.equal(t.runId, targeted.workload.runId);
assert.equal(e.status, 'failed'); // Preserve the historical aggregate-count failure.
assert.equal(e.soak.checks.bounded, false);
assert.equal(t.status, 'complete');
assert.equal(t.pass, true);
assert.ok([e, t, shortened.environment].every((r) => r.cleanup.postgresStopped && r.cleanup.ownedDirectoryRemoved));
const windows = w.windows.filter((v) => v.phase.startsWith('soak-window-'));
const samples = e.monitoring.samples.filter((s) => s.phase.startsWith('soak-window-') && s.api);
const targetedSamples = t.monitoring.samples.filter((s) => s.phase.startsWith('soak-window-') && s.api);
const observed = shortened.environment.monitoring.samples.filter((s) => s.phase.startsWith('soak-window-') && s.api);
const classified = (s) => Number.isInteger(s.database.clientConnections) &&
  s.database.clientConnections >= 0 && s.database.clientConnections <= s.api.pool.policy.max + 3 &&
  Number.isInteger(s.database.backgroundConnections) && s.database.backgroundConnections >= 0 &&
  s.database.activityBackends === s.database.clientConnections + s.database.backgroundConnections;
const logsClean = (logs) => logs?.enabled === true &&
  ['warn', 'error', 'fatal', 'processWarning'].every((key) => logs[key] === 0);
const checks = {
  severalHours: w.complete && windows.length === 180 && windows.every((v) => v.seconds === 60) && e.soak.checks.workload,
  resourceAndErrorMonitoring: e.soak.checks.monitored && samples.length >= 10800 && samples.every((s) =>
    [s.process.cpuCoreEquivalent, s.process.rssBytes, s.database.connections].every((v) => Number.isFinite(v) && v >= 0)),
  noAccumulatingSoakWarningsOrErrors: e.soak.checks.logs && logsClean(e.soak.logs) && e.databaseLogs.pass,
  noSteadyLatencyDegradation: e.soak.checks.performance && e.soak.degradedWorkflows.length === 0 && e.soak.checks.workload,
  connectionsReturnToBaseline: e.soak.checks.idle && e.soak.quiescent.pool.total === 0 &&
    e.soak.quiescent.pool.acquired === e.soak.quiescent.pool.released && e.soak.quiescent.connections === 2,
};
const monitorCorrection = t.soak.checks.bounded && t.soak.checks.idle && t.databaseLogs.pass &&
  targetedSamples.length > 0 && targetedSamples.every(classified) && observed.length > 1000 && observed.every(classified) &&
  t.soak.quiescent.clientConnections === 2 && t.soak.quiescent.pool.total === 0;
const workflows = ['menu', 'product', 'order-status', 'dashboard', 'cashier', 'kitchen'].map((kind) => ({
  kind, reads: windows.reduce((sum, v) => sum + v.byKind[kind].requests, 0),
  maxWindowP95Ms: Math.max(...windows.map((v) => v.byKind[kind].p95Ms)),
  maxWindowP99Ms: Math.max(...windows.map((v) => v.byKind[kind].p99Ms)),
}));
const verdict = {
  version: 2,
  pass: Object.values(checks).every(Boolean) && monitorCorrection,
  scope: 'Five requested local soak criteria, using completed three-hour traffic plus targeted monitor verification; not a passing corrected three-hour profile.',
  checks, monitorCorrection,
  sources: { completedTraffic: priorPath, completedTargetedVerification: targetedPath, userShortenedRepeat: shortenedPath },
  runId: e.runId,
  measuredMinutes: 180,
  successfulReads: windows.reduce((sum, v) => sum + v.successes, 0),
  failures: windows.reduce((sum, v) => sum + v.failures, 0),
  missed: w.missed,
  workflows,
  monitoringSamples: samples.length,
  peakApiRssMiB: Math.max(...samples.map((s) => s.process.rssBytes)) / 1048576,
  peakApiHeapMiB: Math.max(...samples.map((s) => s.process.heapUsedBytes)) / 1048576,
  peakApiCpuCoreEquivalent: Math.max(...samples.map((s) => s.process.cpuCoreEquivalent)),
  quiescent: e.soak.quiescent,
  targetedObservation: {
    completedWindows: shortened.workload.windows.filter((v) => v.phase.startsWith('soak-window-')).length,
    samples: observed.length,
    peakClientConnections: Math.max(...observed.map((s) => s.database.clientConnections)),
    peakBackgroundConnections: Math.max(...observed.map((s) => s.database.backgroundConnections)),
    peakTotalBackends: Math.max(...observed.map((s) => s.database.activityBackends)),
  },
  limitations: [
    'The original three-hour run failed one unclassified total-backend budget check. Its status remains failed.',
    'The corrected monitor passed a complete smoke and 26 observed minutes before the repeat was stopped at user request; no corrected three-hour completion is claimed.',
    'Soak-period log counters exclude separately recorded setup events.',
    'Local API read/auth/session evidence only; no hosted, browser, SSE or write-heavy longevity claim.',
  ],
};
assert.equal(verdict.pass, true);
await writeFile(new URL('soak-criteria-local.json', import.meta.url), JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
