// Own loopback HTTP server only. Never reads an application target or database URL.
import assert from 'node:assert/strict';
import { createServer, request, Agent } from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { ApiObservabilityService } from '../dist/common/observability/api-observability.service.js';

const durationMs = 10000,
  concurrency = 8;
const modes = ['off', 'metrics', 'logging'];
const quantile = (values, fraction) =>
  values[Math.ceil(values.length * fraction) - 1];

async function worker(mode) {
  assert.ok(modes.includes(mode));
  Logger.overrideLogger(new ConsoleLogger({ json: true, colors: false }));
  const service = new ApiObservabilityService(
    new ConfigService({
      API_OBSERVABILITY_REQUEST_LOG_LIMIT: mode === 'logging' ? 10 : 0,
      API_OBSERVABILITY_LOG_INTERVAL_MS: mode === 'logging' ? 10000 : 0,
    }),
    { databasePoolSnapshot: () => ({ total: 0, waiting: 0 }) },
    { snapshot: () => ({ active: { total: 0 } }) },
  );
  let sequence = 0,
    measuring = false;
  const server = createServer((req, res) => {
    assert.equal(req.url, '/fixture');
    req.route = { path: '/flood-fixture' };
    const respond = () => {
      res.statusCode = measuring ? [200, 401, 429, 503][sequence++ % 4] : 200;
      res.end('ok');
    };
    if (mode === 'off') respond();
    else service.observe(req, res, respond);
  });
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let errors = 0,
    truncated = false;
  const measuredLoop = monitorEventLoopDelay({ resolution: 20 });
  async function drive(milliseconds) {
    const timings = [],
      stop = performance.now() + milliseconds;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (performance.now() < stop) {
          const started = performance.now();
          await new Promise((resolve) => {
            const outgoing = request(
              { hostname: '127.0.0.1', port, path: '/fixture', agent },
              (res) => {
                if (![200, 401, 429, 503].includes(res.statusCode)) errors++;
                res.resume();
                res.once('end', resolve);
                res.once('error', () => {
                  errors++;
                  resolve();
                });
              },
            );
            outgoing.setTimeout(3000, () =>
              outgoing.destroy(new Error('fixture-deadline')),
            );
            outgoing.once('error', () => {
              errors++;
              resolve();
            });
            outgoing.end();
          });
          if (timings.length < 500000)
            timings.push(performance.now() - started);
          else truncated = true;
        }
      }),
    );
    return timings;
  }
  try {
    await drive(500);
    const before = service.snapshot(),
      cpu = process.cpuUsage(),
      start = performance.now();
    measuredLoop.enable();
    measuring = true;
    const timings = await drive(durationMs);
    const elapsedMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    measuredLoop.disable();
    const after = service.snapshot();
    timings.sort((a, b) => a - b);
    return {
      mode,
      durationMs: elapsedMs,
      requests: timings.length,
      requestsPerSecond: (timings.length * 1000) / elapsedMs,
      p50Ms: quantile(timings, 0.5),
      p95Ms: quantile(timings, 0.95),
      p99Ms: quantile(timings, 0.99),
      cpuCoreEquivalent: (used.user + used.system) / (elapsedMs * 1000),
      rssBytes: after.process.rssBytes,
      eventLoopP95Ms: measuredLoop.percentile(95) / 1e6,
      errors,
      truncated,
      recorded: after.total.count - before.total.count,
      suppressedDiagnostics: after.suppressedDiagnostics,
      routeGroups: after.routes.length,
    };
  } finally {
    measuredLoop.disable();
    agent.destroy();
    await new Promise((resolve) => server.close(resolve));
    service.onModuleDestroy();
  }
}

async function runChild(mode) {
  const child = fork(fileURLToPath(import.meta.url), ['--worker', mode], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].includes(
          key.toUpperCase(),
        ),
      ),
    ),
  });
  let bytes = 0,
    diagnostics = 0,
    exports = 0,
    pending = '',
    stderrBytes = 0;
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
  });
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    pending += chunk.toString();
    if (pending.length > 131072) {
      child.kill();
      return;
    }
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (line.includes('api.request.diagnostic')) diagnostics++;
      if (line.includes('api.metrics')) exports++;
    }
  });
  return new Promise((resolve, reject) => {
    let report;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Flood fixture deadline'));
    }, 25000);
    child.once('message', (value) => {
      report = value;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !report) reject(new Error('Flood fixture failed'));
      else
        resolve({
          ...report,
          logBytes: bytes,
          diagnosticLogs: diagnostics,
          aggregateLogs: exports,
          stderrBytes,
        });
    });
  });
}

if (process.argv[2] === '--worker') {
  try {
    const report = await worker(process.argv[3]);
    process.send(report, () => process.disconnect());
  } catch {
    process.exitCode = 1;
    process.disconnect?.();
  }
} else {
  assert.equal(
    process.argv.length,
    2,
    'No application targets or arbitrary profiles are accepted',
  );
  const output = new URL(
    '../../../artifacts/performance/api-observability-flood-local.json',
    import.meta.url,
  );
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({
      pass: false,
      status: 'starting',
      at: new Date().toISOString(),
    }) + '\n',
  );
  const runs = [];
  // Reverse the second round to reduce simple run-order bias.
  for (const mode of [...modes, ...modes.toReversed()]) {
    let report;
    try {
      report = await runChild(mode);
    } catch {
      await writeFile(
        output,
        JSON.stringify({ pass: false, status: 'failed', completedRuns: runs }) +
          '\n',
      );
      throw new Error('Isolated logging benchmark failed; see local report.');
    }
    runs.push(report);
    console.log(
      `${mode}: ${report.requests} requests, p95=${report.p95Ms.toFixed(2)}ms, ${report.diagnosticLogs} diagnostic logs`,
    );
  }
  const average = (mode, key) =>
    runs
      .filter((run) => run.mode === mode)
      .reduce((sum, run) => sum + run[key], 0) / 2;
  const baseline = Object.fromEntries(
    ['requestsPerSecond', 'p95Ms', 'p99Ms', 'rssBytes', 'eventLoopP95Ms'].map(
      (key) => [key, average('off', key)],
    ),
  );
  const metrics = Object.fromEntries(
    Object.keys(baseline).map((key) => [key, average('metrics', key)]),
  );
  const logging = Object.fromEntries(
    Object.keys(baseline).map((key) => [key, average('logging', key)]),
  );
  const checks = {
    complete: runs.every(
      (run) =>
        run.durationMs >= durationMs &&
        run.requests >= 2000 &&
        run.errors === 0 &&
        !run.truncated &&
        run.stderrBytes === 0,
    ),
    accounting: runs.every(
      (run) => run.mode === 'off' || run.recorded === run.requests,
    ),
    boundedOutput: runs.every((run) =>
      run.mode !== 'logging'
        ? run.logBytes === 0
        : run.diagnosticLogs === 10 &&
          run.aggregateLogs >= 1 &&
          run.aggregateLogs <= 2 &&
          run.logBytes <= 131072 &&
          run.suppressedDiagnostics > 0,
    ),
    boundedLabels: runs.every((run) => run.routeGroups <= 1),
    instrumentationThroughput:
      metrics.requestsPerSecond >= baseline.requestsPerSecond * 0.6,
    loggingThroughput:
      logging.requestsPerSecond >= metrics.requestsPerSecond * 0.8,
    loggingP95: logging.p95Ms <= metrics.p95Ms * 1.5 + 5,
    loggingP99: logging.p99Ms <= metrics.p99Ms * 2 + 10,
    loggingMemory: logging.rssBytes <= metrics.rssBytes + 64 * 1024 * 1024,
    loggingEventLoop: logging.eventLoopP95Ms <= metrics.eventLoopP95Ms * 2 + 25,
  };
  const report = {
    version: 2,
    status: Object.values(checks).every(Boolean) ? 'complete' : 'failed',
    pass: Object.values(checks).every(Boolean),
    at: new Date().toISOString(),
    checks,
    scope:
      'disposable-loopback-HTTP; API and clients share one process per run; real drained stdout pipe',
    limitations:
      'Not hosted log transport, a blocked log sink, database capacity, or end-to-end application capacity.',
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      durationMs,
      concurrency,
    },
    baseline,
    metrics,
    logging,
    runs,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pass: report.pass, checks }));
  if (!report.pass) process.exitCode = 1;
}
