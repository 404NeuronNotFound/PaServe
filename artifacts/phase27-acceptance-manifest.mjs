// Build a read-only-audit input bundle from preserved fresh results. No traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { evidenceManifest } from '../scripts/performance-acceptance.mjs';
import { validateRecoveryReport } from '../scripts/failure-recovery-results.mjs';
const root = resolve(import.meta.dirname, '..');
const artifacts = resolve(root, 'artifacts/performance');
const directory = resolve(artifacts, 'phase27-audit/20261101-004923');
const read = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const manifest = { ...evidenceManifest };
const inputs = [
  ['login', 'load-login-flood', 'load-environment-login-flood-local.json', 'login-flood-workload-local.json'],
  ['menu', 'load-menu-spike', 'load-environment-menu-spike-local.json', 'menu-spike-workload-local.json'],
  ['orders', 'order-burst-retry', 'load-environment-order-burst-local.json', 'order-burst-workload-local.json'],
  ['capacity', 'load-capacity', 'load-environment-capacity-local.json', 'load-capacity-workload-local.json'],
  ['spike', 'load-spike', 'load-environment-spike-local.json', 'load-spike-workload-local.json'],
];
for (const [key, folder, envName, workloadName] of inputs) {
  const environment = await read(resolve(directory, folder, envName));
  const workload = await read(resolve(directory, folder, workloadName));
  assert.equal(environment.pass, true, `${key} final environment must pass`);
  assert.equal(environment.status, 'complete');
  const file = resolve(directory, `${key}-acceptance-evidence.json`);
  await writeFile(file, JSON.stringify({ version: 1, capturedAt: new Date().toISOString(),
    purpose: 'Fresh Phase 27 isolated local validation; original diagnostic failures remain preserved',
    environment, workload }, null, 2) + '\n', { flag: 'wx' });
  manifest[key] = relative(artifacts, file).replaceAll('\\', '/');
}
for (const [key, folder, name] of [
  ['pooling', 'pooling', 'database-pooling-local.json'],
  ['tenants', 'tenants', 'tenant-query-performance-local.json'],
]) manifest[key] = relative(artifacts, resolve(directory, folder, name)).replaceAll('\\', '/');
const steps = await read(resolve(directory, 'results.json'));
const recovery = steps.find((step) => step.name === 'failure-recovery');
assert.equal(recovery?.exitCode, 0, 'Fresh recovery stage must pass');
const candidates = [];
for (const entry of await readdir(resolve(artifacts, 'failure-recovery/runs'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = resolve(artifacts, 'failure-recovery/runs', entry.name, 'result.json');
  let modified;
  try { modified = (await stat(file)).mtimeMs; }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (modified < Date.parse(recovery.startedAt) || modified > Date.parse(recovery.finishedAt) + 1000) continue;
  try { validateRecoveryReport(await read(file)); candidates.push(file); } catch { /* non-result files */ }
}
assert.equal(candidates.length, 1, 'Require exactly one fresh, validated recovery result');
manifest.failure = relative(artifacts, candidates[0]).replaceAll('\\', '/');
const output = resolve(directory, 'acceptance-manifest.json');
await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(relative(root, output));
