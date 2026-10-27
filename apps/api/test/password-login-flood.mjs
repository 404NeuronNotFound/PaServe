// Real NestJS + real Argon2, separate server/client processes, fixture storage only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { availableParallelism } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import {
  summarizeTimes,
  evaluateLocalFlood,
} from './password-login-flood.metrics.mjs';

const durationMs = Number(process.env.HASH_FLOOD_DURATION_MS ?? 5000);
if (!Number.isInteger(durationMs) || durationMs < 3000 || durationMs > 15_000)
  throw new Error('HASH_FLOOD_DURATION_MS must be 3000-15000');
const reportPath = resolve(
  process.env.HASH_FLOOD_REPORT ??
    '../../artifacts/performance/password-login-flood-local.json',
);
const password = 'Disposable local HTTP capacity fixture password';
function startFixture() {
  const child = fork(
    new URL('./password-login-flood.fixture.mjs', import.meta.url),
    [],
    {
      cwd: resolve(import.meta.dirname, '..'),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? '4',
        FRONTEND_ORIGINS: 'http://localhost',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unused',
        SUPABASE_URL: 'https://capacity-fixture.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'local-unused-capacity-service-key',
        JWT_ACCESS_SECRET: 'local-capacity-access-fixture-only-secret',
        JWT_REFRESH_SECRET: 'local-capacity-refresh-fixture-only-secret',
      },
    },
  );
  let nextId = 0,
    diagnostics = '';
  const pending = new Map();
  const exit = once(child, 'exit');
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data.toString()).slice(-4096);
  });
  const ready = new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Local fixture startup timed out')),
      20_000,
    );
    child.on('message', (message) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        done(message);
      } else if (message.type === 'fatal') {
        clearTimeout(timer);
        reject(new Error(message.error));
      } else if (pending.has(message.id)) {
        const wait = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(wait.timer);
        if (message.error) wait.reject(new Error(message.error));
        else wait.done(message.value);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Local fixture exited unexpectedly: ${diagnostics}`));
      for (const wait of pending.values()) {
        clearTimeout(wait.timer);
        wait.reject(new Error('Local fixture exited'));
      }
      pending.clear();
    });
  });
  const rpc = (type) =>
    new Promise((done, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Fixture command timed out: ${type}`));
      }, 5000);
      pending.set(id, { timer, done, reject });
      child.send({ id, type }, (error) => {
        if (error && pending.has(id)) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    });
  return {
    ready,
    rpc,
    async stop() {
      try {
        if (child.connected) await rpc('stop');
      } finally {
        const ended = await Promise.race([
          exit.then(() => true),
          pause(5000, false, { ref: false }),
        ]);
        if (!ended) {
          child.kill();
          await exit;
        }
      }
    },
  };
}
function send(port, localAddress, path, { body, token, forwarded } = {}) {
  const start = performance.now();
  return new Promise((done) => {
    let finished = false;
    const finish = (reply) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        done({ ...reply, ms: performance.now() - start });
      }
    };
    const payload = body ? JSON.stringify(body) : undefined;
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        localAddress,
        path,
        method: body ? 'POST' : 'GET',
        agent: false,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-PaServe-Client': 'web',
              }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}),
        },
      },
      (response) => {
        let value = '';
        response.on('data', (data) => {
          value += data;
          if (value.length > 32_768)
            request.destroy(new Error('Fixture response too large'));
        });
        response.on('end', () => {
          let json;
          try {
            json = JSON.parse(value);
          } catch {
            /* A malformed response is not a pass. */
          }
          finish({
            status: response.statusCode,
            json,
            retryAfter: Number(response.headers['retry-after']),
            noStore: String(response.headers['cache-control']).includes(
              'no-store',
            ),
            ipBudgetEmpty: response.headers['x-ratelimit-remaining'] === '0',
            hashJobsAtStart: Number(
              response.headers['x-capacity-fixture-hash-jobs'] ?? 0,
            ),
          });
        });
        response.on('error', () => finish({ networkError: true }));
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error('Local HTTP request deadline')),
      3000,
    );
    request.on('error', () => finish({ networkError: true }));
    request.end(payload);
  });
}
async function runScenario(mode) {
  const fixture = startFixture();
  try {
    const setup = await fixture.ready;
    const actors = [
      {
        role: 'OWNER',
        id: '10000000-0000-4000-8000-000000000001',
        address: '127.0.0.3',
        email: 'owner@capacity.example.invalid',
      },
      {
        role: 'CASHIER',
        id: '10000000-0000-4000-8000-000000000002',
        address: '127.0.0.4',
        email: 'cashier@capacity.example.invalid',
      },
    ];
    for (const actor of actors) {
      const reply = await send(
        setup.port,
        actor.address,
        '/api/v1/auth/login',
        { body: { email: actor.email, password } },
      );
      assert.equal(
        reply.status,
        200,
        'Fixture sign-in must use the real login flow',
      );
      actor.token = reply.json.accessToken;
    }
    const baseline = [],
      healthy = [],
      overlap = [],
      healthyByRoute = { menu: [], ownerSession: [], cashierSession: [] },
      loginTimes = [];
    let healthyFailures = 0,
      loginFailures = 0,
      missedProbeSchedules = 0;
    async function probes(measured) {
      const replies = await Promise.all([
        send(setup.port, '127.0.0.5', '/api/v1/menu/capacity-cafe'),
        ...actors.map((actor) =>
          send(setup.port, actor.address, '/api/v1/auth/me', {
            token: actor.token,
          }),
        ),
      ]);
      const valid = [
        (reply) =>
          reply.json?.shop?.slug === 'capacity-cafe' &&
          reply.json?.products?.[0]?.price === '4.50',
        ...actors.map(
          (actor) => (reply) =>
            reply.json?.user?.id === actor.id &&
            reply.json?.user?.memberships?.[0]?.role === actor.role,
        ),
      ];
      replies.forEach((reply, index) => {
        if (reply.status !== 200 || !valid[index](reply)) {
          healthyFailures++;
          return;
        }
        if (measured) {
          healthy.push(reply.ms);
          healthyByRoute[
            ['menu', 'ownerSession', 'cashierSession'][index]
          ].push(reply.ms);
          if (reply.hashJobsAtStart > 0) overlap.push(reply.ms);
        } else baseline.push(reply.ms);
      });
    }
    for (let i = 0; i < 10; i++) {
      await probes(false);
      await pause(30);
    }
    assert.equal(
      healthyFailures,
      0,
      'Baseline authenticated/menu probes must pass',
    );
    const attacker = {
      statuses: {},
      unexpected: 0,
      networkErrors: 0,
      latencies: [],
      native401: [],
      challenged403: [],
      limited429: [],
      missedSchedules: 0,
      earlyIpRejections: 0,
    };
    let sequence = 0;
    async function attackRequest() {
      const index = sequence++;
      const reply = await send(setup.port, '127.0.0.2', '/api/v1/auth/login', {
        body: {
          email:
            index % 2
              ? 'missing@capacity.example.invalid'
              : 'attacker@capacity.example.invalid',
          password: 'incorrect fixture password',
        },
        forwarded: `192.0.2.${(index % 250) + 1}`,
      });
      if (reply.networkError) {
        attacker.networkErrors++;
        return;
      }
      attacker.statuses[reply.status] =
        (attacker.statuses[reply.status] ?? 0) + 1;
      attacker.latencies.push(reply.ms);
      const code = {
        401: 'INVALID_CREDENTIALS',
        403: 'BOT_CHALLENGE_REQUIRED',
        429: 'RATE_LIMIT_EXCEEDED',
      }[reply.status];
      if (
        !code ||
        reply.json?.code !== code ||
        !reply.noStore ||
        (reply.status === 429 && !(reply.retryAfter >= 1))
      )
        attacker.unexpected++;
      if (reply.status === 401) attacker.native401.push(reply.ms);
      if (reply.status === 403) attacker.challenged403.push(reply.ms);
      if (reply.status === 429) attacker.limited429.push(reply.ms);
      if (reply.status === 429 && reply.ipBudgetEmpty)
        attacker.earlyIpRejections++;
    }
    await fixture.rpc('begin');
    const start = performance.now(),
      end = start + durationMs;
    const healthyTask = (async () => {
      for (let target = start; target < end; target += 200) {
        await pause(Math.max(0, target - performance.now()));
        if (performance.now() - target >= 200) missedProbeSchedules++;
        await probes(true);
      }
    })();
    const cleanLoginTask = (async () => {
      await pause(1000);
      const actor = actors[0];
      const reply = await send(
        setup.port,
        actor.address,
        '/api/v1/auth/login',
        { body: { email: actor.email, password } },
      );
      if (
        reply.status === 200 &&
        reply.json?.user?.id === actor.id &&
        reply.json?.accessToken
      )
        loginTimes.push(reply.ms);
      else loginFailures++;
    })();
    const attackTask = (async () => {
      if (mode === 'progressive-escalation')
        for (let i = 0; i < 3; i++) await attackRequest();
      const active = new Set();
      const launch = () => {
        const promise = attackRequest().finally(() => active.delete(promise));
        active.add(promise);
      };
      for (let i = 0; i < 12; i++) launch();
      for (let target = performance.now(); target < end; target += 40) {
        await pause(Math.max(0, target - performance.now()));
        if (active.size >= 12) attacker.missedSchedules++;
        else launch();
      }
      await Promise.all(active);
    })();
    let busy = false;
    for (let i = 0; i < 100; i++) {
      if ((await fixture.rpc('inspect')).active > 0) {
        busy = true;
        break;
      }
      await pause(5);
    }
    assert.ok(
      busy,
      'Must observe real native hashing, not just fast rate-limit responses',
    );
    const poolProbe = await fixture.rpc('poolProbe');
    await probes(true);
    await Promise.all([attackTask, healthyTask, cleanLoginTask]);
    // Recovery is measured while admission state is intact; no limiter reset.
    for (const actor of actors) {
      const reply = await send(
        setup.port,
        actor.address,
        '/api/v1/auth/login',
        { body: { email: actor.email, password } },
      );
      if (reply.status === 200 && reply.json?.accessToken)
        loginTimes.push(reply.ms);
      else loginFailures++;
    }
    await probes(true);
    const server = await fixture.rpc('finish');
    const summary = {
      mode,
      policy: setup.policy,
      configuredThreadpoolSize: setup.configuredThreadpoolSize,
      durationMs,
      baseline: summarizeTimes(baseline),
      attacker: {
        statuses: attacker.statuses,
        unexpected: attacker.unexpected,
        networkErrors: attacker.networkErrors,
        offeredSchedulesMissed: attacker.missedSchedules,
        earlyIpRejections: attacker.earlyIpRejections,
        credentialFailures: summarizeTimes(attacker.native401),
        challenges: summarizeTimes(attacker.challenged403),
        throttled: summarizeTimes(attacker.limited429),
      },
      healthy: {
        failures: healthyFailures,
        latency: summarizeTimes(healthy),
        byRoute: Object.fromEntries(
          Object.entries(healthyByRoute).map(([key, values]) => [
            key,
            summarizeTimes(values),
          ]),
        ),
      },
      overlapHealthy: summarizeTimes(overlap),
      cleanLogins: {
        failures: loginFailures,
        latency: summarizeTimes(loginTimes),
      },
      poolProbe,
      missedProbeSchedules,
      server,
    };
    summary.acceptance = evaluateLocalFlood(summary);
    if (mode === 'progressive-escalation' && !attacker.statuses['403'])
      summary.acceptance = {
        checks: {
          ...summary.acceptance.checks,
          progressiveChallengeObserved: false,
        },
        pass: false,
      };
    return summary;
  } finally {
    await fixture.stop();
  }
}
const scenarios = [];
for (const mode of ['parallel-single-client', 'progressive-escalation'])
  scenarios.push(await runScenario(mode));
const report = {
  environment: 'local-nestjs-http-real-argon2-fixture-storage',
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  availableParallelism: availableParallelism(),
  clientAndServerProcessesSeparate: true,
  protectionsDisabled: false,
  limiterResetsDuringMeasurement: false,
  transport:
    'Distinct loopback socket source addresses; proxy trust disabled; forged forwarding headers do not change identity',
  budgets: {
    healthyP95Ms: 500,
    overlappedHealthyP95Ms: 500,
    filesystemProbeMs: 500,
    legitimateLoginP95Ms: 1000,
  },
  scenarios,
  pass: scenarios.every((scenario) => scenario.acceptance.pass),
  limitations: [
    'Fixture repositories; no real database/connection pool/network/CDN',
    'CPU and RSS are measured in the server child, not the load generator',
    'Local short smoke checks do not establish deployed p95/p99 or supported user counts',
    'Configured test limits match existing defaults; Argon2 work factor is not reduced',
    'CPU quotas, production sizing and deployed workflow isolation remain pending',
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      report: reportPath,
      pass: report.pass,
      scenarios: scenarios.map((scenario) => ({
        mode: scenario.mode,
        acceptance: scenario.acceptance,
        attackStatuses: scenario.attacker.statuses,
        healthyP95Ms: scenario.healthy.latency.p95Ms,
        overlappingProbeSamples: scenario.overlapHealthy.samples,
        serverCpuCoreEquivalent: scenario.server.cpuCoreEquivalent,
        peakCpuCoreEquivalent: Math.max(
          ...scenario.server.cpuSamples.map(
            (sample) => sample.cpuCoreEquivalent,
          ),
        ),
      })),
    },
    null,
    2,
  ),
);
if (!report.pass) process.exitCode = 1;
