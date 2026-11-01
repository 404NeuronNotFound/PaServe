// Private child of the disposable recovery fixture. No CLI target is accepted.
import assert from 'node:assert/strict';
import { request, Agent } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const workloadProfile = {
  version: 1,
  durationMs: 40000,
  requests: 4000,
  arrivalRps: 100,
  maxInFlight: 8,
  sourceAddresses: 32,
  requestDeadlineMs: 3000,
  maxDispatchLagMs: 100,
  mix: { read: 0.25, write: 0.25, readiness: 0.25, liveness: 0.25 },
  seed: { tables: 1, rows: 1, realTenants: 0 },
  sampleIntervalMs: 100,
  slowQueryThresholdMs: 100,
  calibrationQueryMs: 280,
};
const routes = [
  ['read', 'GET', '/api/v1/recovery-fixture/read', 200],
  ['write', 'POST', '/api/v1/recovery-fixture/locked', 201],
  ['readiness', 'GET', '/api/v1/health', 200],
  ['liveness', 'GET', '/api/v1/health/live', 200],
];
export function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) =>
    sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return {
    samples: sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    p95Evidence: sorted.length >= 100,
    p99Evidence: sorted.length >= 1000,
  };
}

async function run(origin) {
  const url = new URL(origin);
  assert.ok(
    process.connected &&
      process.env.TIMEOUT_DB_LOCAL_FIXTURE === 'true' &&
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'Only an owned loopback fixture is allowed',
  );
  const profile = workloadProfile,
    groups = Object.fromEntries(
      routes.map(([name]) => [
        name,
        {
          scheduled: 0,
          sent: 0,
          completed: 0,
          success: 0,
          transportErrors: 0,
          unexpected: 0,
          missed: 0,
          statuses: {},
          timings: [],
        },
      ]),
    );
  const agents = Array.from(
    { length: profile.sourceAddresses },
    () => new Agent({ keepAlive: true, maxSockets: 1 }),
  );
  const pending = new Set(),
    all = [];
  let peakInFlight = 0;
  const start = performance.now();
  try {
    for (let index = 0; index < profile.requests; index++) {
      const [name, method, path, expected] = routes[index % routes.length],
        group = groups[name];
      group.scheduled++;
      const due = start + (index * 1000) / profile.arrivalRps;
      await delay(Math.max(0, due - performance.now()));
      if (
        performance.now() - due > profile.maxDispatchLagMs ||
        pending.size >= profile.maxInFlight
      ) {
        group.missed++;
        continue;
      }
      group.sent++;
      const address = index % profile.sourceAddresses;
      const work = new Promise((resolve) => {
        const began = performance.now();
        let settled = false;
        const finish = (ok, status, transport = false) => {
          if (settled) return;
          settled = true;
          if (transport) group.transportErrors++;
          else {
            group.completed++;
            group.statuses[status] = (group.statuses[status] ?? 0) + 1;
            if (ok) {
              group.success++;
              const ms = performance.now() - began;
              group.timings.push(ms);
              all.push(ms);
            } else group.unexpected++;
          }
          resolve();
        };
        const outgoing = request(
          {
            hostname: '127.0.0.1',
            port: Number(url.port),
            method,
            path,
            agent: agents[address],
            localAddress: `127.0.0.${address + 2}`,
            headers: { 'Content-Length': '0' },
          },
          (response) => {
            let body = '',
              bytes = 0;
            response.on('data', (chunk) => {
              bytes += chunk.length;
              if (bytes > 16384) outgoing.destroy();
              else body += chunk.toString();
            });
            response.once('error', () => finish(false, null, true));
            response.once('aborted', () => finish(false, null, true));
            response.once('end', () => {
              let valid = false;
              try {
                const data = JSON.parse(body);
                valid =
                  name === 'read'
                    ? Number.isInteger(data.value)
                    : name === 'write'
                      ? data.updated === 1
                      : name === 'readiness'
                        ? data.database === 'connected'
                        : data.api === 'ok';
              } catch {
                /* invalid fixture result */
              }
              finish(
                response.statusCode === expected && valid,
                response.statusCode,
              );
            });
          },
        );
        outgoing.setTimeout(profile.requestDeadlineMs, () =>
          outgoing.destroy(),
        );
        outgoing.once('error', () => finish(false, null, true));
        outgoing.end();
      });
      pending.add(work);
      peakInFlight = Math.max(peakInFlight, pending.size);
      void work.finally(() => pending.delete(work));
    }
    await Promise.all(pending);
    await delay(Math.max(0, start + profile.durationMs - performance.now()));
    const elapsedMs = performance.now() - start;
    const workflows = Object.fromEntries(
      Object.entries(groups).map(([name, group]) => {
        const { timings, ...counts } = group;
        return [
          name,
          {
            ...counts,
            latency: latency(timings),
            successRps: (group.success * 1000) / elapsedMs,
          },
        ];
      }),
    );
    return {
      profile,
      elapsedMs,
      peakInFlight,
      workflows,
      latency: latency(all),
      successRps: (all.length * 1000) / elapsedMs,
      completedRps:
        (Object.values(groups).reduce((n, group) => n + group.completed, 0) *
          1000) /
        elapsedMs,
    };
  } finally {
    for (const agent of agents) agent.destroy();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.ok(process.connected, 'Run through the owned recovery fixture');
  process.once('message', async ({ origin }) => {
    try {
      const result = await run(origin);
      process.send({ result }, () => process.disconnect());
    } catch {
      process.send({ failed: true }, () => process.disconnect());
      process.exitCode = 1;
    }
  });
}
