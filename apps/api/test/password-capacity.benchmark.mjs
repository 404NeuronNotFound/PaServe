// Bounded local native-Argon2 benchmark. No database, account or production traffic.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import {
  PasswordHashService,
  PASSWORD_HASH_POLICY,
} from '../dist/modules/auth/password-hash.service.js';

const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (fraction) =>
    sorted.length
      ? Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 100) / 100
      : null;
  return {
    samples: sorted.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    tailSampleSufficient: sorted.length >= 100,
  };
};
const reportPath = resolve(
  process.env.HASH_CAPACITY_REPORT ??
    '../../artifacts/performance/password-hashing-local.json',
);
const fixture = 'Disposable native password benchmark fixture';
const server = http.createServer((_request, response) => {
  response.end('ok');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
async function httpProbe() {
  await new Promise((done, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/', agent: false },
      (response) => {
        response.resume();
        response.on('end', () =>
          response.statusCode === 200
            ? done()
            : reject(new Error('Probe status failure')),
        );
        response.on('error', reject);
      },
    );
    request.setTimeout(2000, () => request.destroy(new Error('Probe timeout')));
    request.on('error', reject);
  });
}
async function scenario(concurrency, burst) {
  const service = new PasswordHashService(
    new ConfigService({
      AUTH_HASH_MAX_CONCURRENT: String(concurrency),
      AUTH_HASH_MEMORY_MB: '128',
    }),
  );
  await service.onModuleInit();
  const digest = await service.hash(fixture);
  const before = service.snapshot();
  const success = [],
    rejected = [],
    probes = [],
    fsProbes = [];
  let probeFailures = 0,
    missedProbeSchedules = 0,
    probing = false;
  let inProbe = Promise.resolve();
  let peakRss = process.memoryUsage().rss;
  const baselineRss = peakRss;
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (probing) {
      missedProbeSchedules++;
      return;
    }
    probing = true;
    inProbe = (async () => {
      let start = performance.now();
      try {
        await httpProbe();
        probes.push(performance.now() - start);
      } catch {
        probeFailures++;
      }
      start = performance.now();
      try {
        await stat(new URL('../package.json', import.meta.url));
        fsProbes.push(performance.now() - start);
      } catch {
        probeFailures++;
      }
    })().finally(() => {
      probing = false;
    });
  }, 20);
  const cpu = process.cpuUsage();
  const start = performance.now();
  try {
    const batches = burst ? 12 : 20;
    for (let batch = 0; batch < batches; batch++) {
      await Promise.all(
        Array.from({ length: burst ? 12 : 1 }, async () => {
          const begin = performance.now();
          try {
            assert.equal(await service.verify(digest, fixture), true);
            success.push(performance.now() - begin);
          } catch (error) {
            if (error?.getStatus?.() !== 429) throw error;
            rejected.push(performance.now() - begin);
          }
        }),
      );
    }
  } finally {
    clearInterval(timer);
    await inProbe;
    eventLoop.disable();
  }
  const elapsedMs = performance.now() - start;
  const usedCpu = process.cpuUsage(cpu);
  const after = service.snapshot();
  assert.ok(after.peakActive <= concurrency);
  assert.ok(after.peakReservedKiB <= after.memoryBudgetKiB);
  assert.equal(after.active, 0);
  assert.equal(after.reservedKiB, 0);
  assert.equal(probeFailures, 0);
  assert.equal(success.length, (burst ? 12 : 20) * (burst ? concurrency : 1));
  return {
    workload: burst
      ? '12 synchronized attempts per batch, 12 batches'
      : '20 sequential verifications',
    concurrency,
    elapsedMs: Math.round(elapsedMs),
    accepted: summarize(success),
    rejected: summarize(rejected),
    httpEventLoopProbe: summarize(probes),
    fileSystemThreadpoolProbe: summarize(fsProbes),
    probeFailures,
    missedProbeSchedules,
    eventLoopP95Ms: Math.round(eventLoop.percentile(95) / 10_000) / 100,
    cpuCoreEquivalent:
      Math.round((usedCpu.user + usedCpu.system) / elapsedMs / 10) / 100,
    baselineRssMiB: Math.round(baselineRss / 1024 / 1024),
    sampledPeakRssMiB: Math.round(peakRss / 1024 / 1024),
    nativeWork: {
      started: after.started - before.started,
      rejected: after.rejected - before.rejected,
      peakActive: after.peakActive,
      peakReservedKiB: after.peakReservedKiB,
      memoryBudgetKiB: after.memoryBudgetKiB,
    },
  };
}
try {
  const pool = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  const levels = [...new Set([1, Math.min(2, pool - 1)])];
  const results = [await scenario(1, false)];
  for (const level of levels) results.push(await scenario(level, true));
  const report = {
    environment: 'local-native-argon2-component-only',
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    availableParallelism: availableParallelism(),
    configuredThreadpoolSize: pool,
    policy: PASSWORD_HASH_POLICY,
    results,
    resourceBoundsPass: true,
    limitations: [
      'Not NestJS/database/CDN or distinct-user capacity',
      'Warm-up and fixture hash excluded from measured scenarios',
      'CPU is process CPU divided by wall time; 1.0 represents one core',
      'RSS includes Node/native overhead and previous allocations, not just Argon2',
      'Rejected jobs are excluded from accepted latency percentiles',
      'Short local samples are not production p95/p99 guarantees',
    ],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
