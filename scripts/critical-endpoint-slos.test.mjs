import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { criticalEndpointSloPolicy as policy, criticalEndpointMarkdown } from './critical-endpoint-slos.mjs';

test('critical endpoint targets are explicit, unique and retain the error/sample rules', () => {
  const ids = policy.endpoints.map((row) => `${row.method} ${row.route}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(policy.endpoints.length > 40);
  for (const row of policy.endpoints) {
    assert.ok(Number.isFinite(row.p95Ms) && row.p95Ms > 0 && row.p99Ms >= row.p95Ms);
    assert.equal(row.maximumErrorRate, .001);
    assert.ok(['api-complete-body', 'logical-order-result'].includes(row.boundary));
  }
  assert.equal(policy.minimumP99Samples, 1000);
  assert.equal(policy.minimumObservationSeconds, 60);
});

test('published endpoint targets match the executable catalog', async () => {
  const published = await readFile(new URL('../docs/critical-endpoint-slos.md', import.meta.url), 'utf8');
  assert.equal(published.replaceAll('\r\n', '\n'), criticalEndpointMarkdown());
});

test('all finite staff routes reserving critical capacity have an explicit target', async () => {
  const directory = new URL('../apps/api/src/modules/orders/', import.meta.url);
  const recorded = new Set(policy.endpoints.map((row) => `${row.method} ${row.route}`));
  let checked = 0;
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.controller.ts'))) {
    const source = await readFile(new URL(file, directory), 'utf8');
    if (!source.includes('@CriticalCapacity()')) continue;
    const controller = source.match(/@Controller\('([^']+)'\)/)?.[1];
    assert.ok(controller);
    const classCritical = source.slice(0, source.indexOf('export class')).includes('@CriticalCapacity()');
    const methods = [...source.matchAll(/@(Get|Post|Patch|Delete)\((?:'([^']*)')?\)/g)];
    for (let index = 0; index < methods.length; index++) {
      const method = methods[index], block = source.slice(method.index, methods[index + 1]?.index ?? source.length);
      if (!classCritical && !block.includes('@CriticalCapacity()')) continue;
      const route = `/api/v1/${controller}/${method[2] ?? ''}`.replace(/\/$/, '');
      assert.ok(recorded.has(`${method[1].toUpperCase()} ${route}`), `Missing critical route target: ${route}`);
      checked++;
    }
  }
  assert.ok(checked >= 20, 'Critical-route scan did not cover current staff controllers');
});
