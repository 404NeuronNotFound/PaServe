import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { criticalEndpointSloPolicy } from './critical-endpoint-slos.mjs';
import { validateRecoveryReport } from './failure-recovery-results.mjs';
import { evaluateLoginFlood } from '../apps/api/test/login-flood.metrics.mjs';
import { evaluateMenuSpike } from '../apps/api/test/menu-spike.metrics.mjs';
import { evaluateOrderBurst } from '../apps/api/test/order-burst.metrics.mjs';
import { evaluateTrafficSpike } from '../apps/api/test/load-spike.metrics.mjs';

export const evidenceManifest = Object.freeze({
  login: 'baselines/2026-10-29-login-flood-v2.json', menu: 'baselines/2026-10-30-menu-spike-v2.json',
  orders: 'baselines/2026-10-30-order-burst-v2.json', capacity: 'baselines/2026-10-30-capacity-v3.json',
  spike: 'baselines/2026-10-30-traffic-spike-v2.json', soak: 'baselines/2026-10-30-soak-criteria-v2.json',
  soakExtended: 'baselines/2026-10-30-soak-extended-v1.json',
  soakOriginal: 'baselines/2026-10-30-soak-multi-hour-v1-diagnostic.json',
  soakTargeted: 'baselines/2026-10-30-soak-classified-smoke-v2.json',
  soakShortened: 'baselines/2026-10-30-soak-multi-hour-v2-user-shortened.json',
  pooling: 'database-pooling-local.json', tenants: 'tenant-query-performance-local.json',
  failure: 'baselines/failure-recovery-2026-11-01-v2.json',
});
const all = (checks) => checks && Object.keys(checks).length > 0 && Object.values(checks).every((value) => value === true);
const unwrap = (source) => source?.report ?? (typeof source?.environment === 'object' ? source.environment : source);
const complete = (source) => source?.pass === true && source.status === 'complete' &&
  source.cleanup?.postgresStopped === true && source.cleanup?.ownedDirectoryRemoved === true;
const domain = (source, key) => { const env = unwrap(source); return complete(env) && env[key]?.pass === true && all(env[key]?.checks); };
function recompute(source, key, evaluate) {
  try {
    const env = unwrap(source), saved = env[key];
    return domain(source, key) && evaluate(source.workload, env.monitoring, saved.evidence, saved.transactions).pass === true;
  } catch { return false; }
}

export function assessMinimumPerformance(input) {
  const items = [];
  const add = (id, criterion, pass, evidence, detail) => items.push({ id, criterion, status: pass ? 'PASS' : 'FAIL',
    scope: 'Recorded isolated local profiles; not a current deployed guarantee', evidence, detail });
  const login = unwrap(input.login)?.loginFlood;
  const loginValid = recompute(input.login, 'loginFlood', evaluateLoginFlood);
  add('login-availability', 'Legitimate users can log in during a bot/login flood', loginValid &&
    login.metrics.legitimate.requests > 0 && login.metrics.legitimate.successes === login.metrics.legitimate.requests &&
    login.metrics.victimDuring.failures === 0 && login.metrics.victimFreshSource.failures === 0,
  ['login'], 'Bounded 30-second, 24-source attack; legitimate/victim sign-ins succeeded. Small login samples do not certify p99 or arbitrary-overload/shared-NAT availability.');
  const monitoredPools = [input.login, input.menu, input.orders, input.capacity, input.spike].every((source) => {
    const monitor = unwrap(source)?.monitoring;
    return monitor?.sampleFailures === 0 && monitor.truncated === false && monitor.samples?.length > 1 &&
      monitor.samples.some((sample) => sample.api?.pool) &&
      monitor.samples.filter((sample) => sample.api?.pool).every((sample) => sample.api.pool.total <= sample.api.pool.policy.max &&
        sample.api.pool.waiting <= sample.api.pool.policy.maxWaiting);
  });
  add('abuse-before-exhaustion', 'Abuse is throttled before unbounded hash/DB consumption', loginValid && monitoredPools &&
    login.checks.hashingBounded && login.checks.hashWorkMeasured && login.checks.noFailedLoginWrites,
  ['login'], 'Recorded attack: 434 attempts, bounded native hashing, challenge/throttle responses and no failed-login account/session writes. Guards retain secure hashing cost.');
  const tenantNames = new Set((input.tenants?.checks ?? []).filter((row) => row.pass === true).map((row) => row.name));
  const tenantsValid = input.tenants?.pass === true && input.tenants.checks.length >= 20 && input.tenants.checks.every((row) => row.pass === true) &&
    tenantNames.has('tenant reads and writes remain isolated during simultaneous cross-shop attempts') &&
    tenantNames.has('membership in both shops does not allow mixing resource IDs');
  add('tenant-isolation', 'No cross-tenant leakage is observed in tested scenarios', tenantsValid && domain(input.orders, 'orderBurst') && domain(input.menu, 'menuSpike'),
    ['tenants', 'orders', 'menu'], 'Live tenant predicates, cross-shop negative controls, concurrent reads/writes and independent catalog keys are covered. This is not proof for every possible future route.');
  const menuValid = recompute(input.menu, 'menuSpike', evaluateMenuSpike), menu = unwrap(input.menu)?.menuSpike;
  add('menu-peak', 'Public menus stay responsive at the tested local peak', menuValid &&
    ['cold-spike', 'warm-spike', 'mixed-spike'].every((phase) => menu.stages.some((row) => row.phase === phase && row.requests === 24 && row.failures === 0 && row.p95Ms <= 500 && row.p99Ms <= 1000)) &&
    domain(input.capacity, 'capacity') && unwrap(input.capacity).capacity.operatingHeadroom.validated,
  ['menu', 'capacity'], 'Three-shop menu/detail spikes and mixed-read headroom are recorded; the eventual hosted lunch-rush peak remains to be established. Small spike cohorts are diagnostic, not SLO tail proof.');
  const orderValid = recompute(input.orders, 'orderBurst', evaluateOrderBurst), orders = unwrap(input.orders)?.orderBurst;
  add('order-burst-correctness', 'Concurrent order bursts preserve prices and critical-record uniqueness', orderValid && orders.evidence.uniqueOrders === 27 &&
    orders.evidence.orderLines === 54 && orders.transactions.unexpectedFailureRate === 0,
  ['orders'], '34 logical submissions produced 27 orders/54 lines including duplicate replays. Transaction conflict rollbacks are recorded separately from final logical success.');
  const poolValid = input.pooling?.pass === true && input.pooling.remainingApplicationConnections === 0 &&
    input.pooling.checks?.length >= 13 && input.pooling.checks.every((row) => row.pass === true) &&
    input.pooling.pools?.length >= 2 && input.pooling.pools.every((pool) => pool.total === 0 && pool.peakTotal <= pool.policy.max);
  items.push({ id: 'pool-and-provider-budget', criterion: 'DB connections respect pool AND provider limits',
    status: poolValid && monitoredPools ? 'CONDITIONAL' : 'FAIL', scope: 'Local pool gate verified; actual provider quota unverified',
    evidence: ['pooling', 'login', 'menu', 'orders', 'capacity', 'spike'],
    detail: 'Configured local per-process/combined pool bounds pass. Hosting/provider quota, replica count plus rolling surge, administrative reserves and Supavisor limits must be verified against the selected deployment; local max_connections is not that quota.' });
  const soak = input.soak, original = unwrap(input.soakOriginal), targeted = unwrap(input.soakTargeted), shortened = unwrap(input.soakShortened);
  const extended = unwrap(input.soakExtended);
  const windows = input.soakOriginal?.workload?.windows?.filter((row) => row.phase.startsWith('soak-window-')) ?? [];
  const soakValid = soak?.pass === true && all(soak.checks) && soak.monitorCorrection === true && soak.measuredMinutes === 180 &&
    soak.failures === 0 && soak.missed === 0 && original?.status === 'failed' && original.soak.checks.bounded === false &&
    original.soak.checks.memory === true && original.soak.checks.performance === true && original.soak.checks.idle === true &&
    input.soakOriginal.workload.complete === true && windows.length === 180 && windows.every((row) => row.seconds === 60 && row.failures === 0) &&
    complete(targeted) && targeted.soak.checks.bounded === true && targeted.soak.checks.idle === true &&
    shortened?.status !== 'complete' && shortened?.cleanup?.postgresStopped === true && shortened.cleanup.ownedDirectoryRemoved === true &&
    complete(extended) && all(extended.soak.checks) &&
    soak.quiescent.pool.total === 0 && soak.quiescent.pool.acquired === soak.quiescent.pool.released;
  add('soak-leaks', 'No sustained memory/connection leak was observed in the recorded soak', soakValid,
    ['soak', 'soakExtended', 'soakOriginal', 'soakTargeted', 'soakShortened'],
    '60-minute profile passed. Combined 180-minute traffic plus targeted monitor correction supports the requested leak criteria. The original aggregate-count gate remains failed; the shortened corrected repeat remains incomplete. No fresh corrected three-hour or current-revision longevity claim.');
  add('critical-endpoint-targets', 'p95/p99 and error budgets are explicitly recorded for critical finite routes',
    criticalEndpointSloPolicy.endpoints.length > 40 && criticalEndpointSloPolicy.endpoints.every((row) =>
      Number.isFinite(row.p95Ms) && row.p99Ms >= row.p95Ms && row.maximumErrorRate === .001),
    ['critical-endpoint-slos'], 'Explicit catalog includes payment creation, order confirmation/rejection and preparation writes. Targets are defined; measured attainment, sufficient samples and browser/realtime targets remain separate.');
  let recovery = false;
  try { validateRecoveryReport(input.failure); recovery = true; } catch { /* failed evidence cannot certify recovery */ }
  add('spike-dependency-recovery', 'Spikes/dependency faults recover without manual business-data repair',
    recompute(input.spike, 'trafficSpike', evaluateTrafficSpike) && recovery,
    ['spike', 'failure'], 'Spike queues drain; restored DB/network/SDK dependencies accept new requests. Rollback, safe errors and fixture cleanup are verified; hosted failover/disaster recovery is separate.');
  add('repeatable-stress-report', 'Versioned stress evidence and rerun commands exist', recovery && input.failure.profile.version === 2 &&
    input.failure.workload.latency.samples === 4000 && input.failure.scenarioVerdicts.length === 31 &&
    [input.login, input.menu, input.orders, input.capacity, input.spike].every((source) => complete(unwrap(source))),
  ['login', 'menu', 'orders', 'capacity', 'spike', 'failure'], 'Recovery reporting is rerunnable with source/environment/seed/profile metadata and comparisons. Each domain stress profile also has its own rerun command; the one-row recovery workload does not replace real menu/login/order/soak tests.');
  return { version: 1, evaluatedAt: new Date().toISOString(), mode: 'read-only recorded-evidence audit',
    status: items.some((row) => row.status === 'FAIL') ? 'FAIL' : items.some((row) => row.status === 'CONDITIONAL') ? 'CONDITIONAL' : 'PASS',
    deploymentReady: false, items, catalogVersion: criticalEndpointSloPolicy.version,
    limitations: ['Historical profiles retain their original dates, source schemas and scopes. This command does not rerun stress traffic or prove all tests pass on the current revision.',
      'Provider limits and hosted peak traffic are not inferred from local PostgreSQL or synthetic data.',
      'The combined soak verdict preserves failed/incomplete diagnostic runs rather than relabeling them.',
      'Auth abuse/challenge state remains single-owner; multiple auth replicas and strict fleet-wide quotas require shared coordination.'] };
}

export function acceptanceMarkdown(report) {
  return `# Phase 27 minimum performance acceptance\n\nOverall: **${report.status}**. Deployment ready: **not established**.\n\nEvaluated: ${report.evaluatedAt}\n\nMode: ${report.mode}\n\n| Criterion | Verdict | Evidence / limits |\n| --- | --- | --- |\n${report.items.map((row) => `| ${row.criterion} | ${row.status} | ${row.detail} |`).join('\n')}\n\n## Evidence identity\n\n${Object.entries(report.sources ?? {}).map(([key, value]) => `- ${key}: ${value.path}; SHA-256 ${value.sha256}`).join('\n')}\n\n## Limits\n\n${report.limitations.map((line) => `- ${line}`).join('\n')}\n\nSee [rerun matrix](../../../docs/performance-minimum-acceptance.md) and [endpoint targets](../../../docs/critical-endpoint-slos.md).\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url)), artifactRoot = resolve(root, 'artifacts/performance');
  const inside = (parent, path) => { const rel = relative(parent, path); return rel && !rel.startsWith('..') && !isAbsolute(rel); };
  try {
    let manifest = evidenceManifest;
    const args = process.argv.slice(2);
    if (args.length) {
      assert.ok(args.length === 2 && args[0] === '--manifest', 'Only --manifest <JSON> is supported');
      const path = resolve(root, args[1]);
      assert.ok(inside(artifactRoot, await realpath(path)) && path.endsWith('.json'), 'Manifest must be an artifact JSON');
      manifest = JSON.parse(await readFile(path, 'utf8'));
      assert.deepEqual(Object.keys(manifest).sort(), Object.keys(evidenceManifest).sort(), 'Manifest requires exactly the known evidence keys');
    }
    const input = {}, sources = {};
    for (const [key, name] of Object.entries(manifest)) {
      assert.ok(typeof name === 'string' && name.endsWith('.json'), 'Evidence must be JSON');
      const path = resolve(artifactRoot, name);
      assert.ok(inside(await realpath(artifactRoot), await realpath(path)), 'Evidence escapes artifacts');
      assert.ok((await stat(path)).size < 128 * 1024 * 1024, 'Evidence too large');
      const bytes = await readFile(path);
      input[key] = JSON.parse(bytes.toString());
      sources[key] = { path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    const report = { ...assessMinimumPerformance(input), sources };
    const directory = resolve(artifactRoot, 'acceptance');
    const physicalRoot = await realpath(artifactRoot);
    // Validate an existing output directory before mkdir can follow a junction.
    try { assert.ok(inside(physicalRoot, await realpath(directory)), 'Output escapes artifacts'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(directory, { recursive: true });
    assert.ok(inside(await realpath(artifactRoot), await realpath(directory)), 'Output escapes artifacts');
    const output = resolve(directory, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}`);
    await writeFile(output + '.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await writeFile(output + '.md', acceptanceMarkdown(report), { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, items: report.items.map(({ id, status }) => ({ id, status })), report: relative(root, output + '.md') }));
    process.exitCode = report.status === 'FAIL' ? 1 : report.status === 'CONDITIONAL' ? 2 : 0;
  } catch { console.error('Acceptance audit failed: check artifact paths, evidence schema and required files. No deployment approval was inferred.'); process.exitCode = 1; }
}

