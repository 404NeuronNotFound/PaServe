import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';
import { validMixedSpike } from './load-spike.workload.mjs';
import {
  capacityProfile as p,
  capacityKinds,
  capacityStageVerdict,
  capacityConclusion,
} from './load-capacity.profile.mjs';

export async function runCapacity(env, hooks) {
  const target = await connectLoadTarget(env, loopbackTransport);
  const accounts = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(accounts.length, 3);
  const date = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Manila',
  });
  const report = {
    version: 1,
    runId: env.LOAD_RUN_ID,
    profile: p,
    startedAt: new Date().toISOString(),
    stages: [],
    controls: [],
    sessionsCreated: 0,
    sessionsRevoked: 0,
    peakInFlight: 0,
    complete: false,
  };
  const sessions = new Set(),
    pending = new Set();
  const request = (path, options = {}) =>
    target.fetch(new URL(path, target.base), {
      ...options,
      signal: AbortSignal.timeout(p.requestMs),
    });
  async function auth(kind, account) {
    const began = performance.now();
    const response = await request(`auth/${kind}`, {
      method: 'POST',
      localAddress: '127.0.0.3',
      headers: {
        'Content-Type': 'application/json',
        'X-PaServe-Client': 'web',
        ...(kind === 'logout' ? { Cookie: account.cookie } : {}),
      },
      body: JSON.stringify(
        kind === 'login'
          ? {
              email: account.email,
              password: account.password,
              keepSignedIn: false,
            }
          : {},
      ),
    });
    if (kind === 'login') {
      const data = await response.json();
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(
        response.ok && cookie && data.accessToken,
        'Capacity fixture login failed.',
      );
      account.cookie = cookie;
      account.token = data.accessToken;
      sessions.add(cookie);
      report.sessionsCreated++;
    } else {
      await response.arrayBuffer(); // Logout intentionally returns 204 with no JSON body.
      if (response.status === 204) {
        sessions.delete(account.cookie);
        report.sessionsRevoked++;
      }
    }
    report.controls.push({
      kind,
      ok: kind === 'logout' ? response.status === 204 : response.ok,
      status: response.status,
      ms: performance.now() - began,
    });
    assert.ok(response.ok, 'Capacity fixture authentication control failed.');
  }
  const checkpoint = () =>
    writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  async function phase(name) {
    await hooks.onStage({ phase: name, type: 'start' });
    // Reattest the same owned capability; no target settings are relaxed.
    await connectLoadTarget(env, loopbackTransport);
  }
  async function stage(role, offeredRps, index, seconds = p.seconds) {
    const name = `capacity-${role}-${index}`;
    await phase(name);
    const samples = [],
      probes = [],
      missedByKind = Object.fromEntries(capacityKinds.map((k) => [k, 0]));
    const missedWindows = Array.from({ length: seconds / p.seconds }, () => 0);
    let missed = 0,
      missedProbes = 0,
      invalidRetryAfter = 0;
    const began = performance.now() + 100;
    async function measure(kind, slot, wave, probe) {
      const tenant = (Math.floor(slot / 4) + wave) % 3,
        account = accounts[tenant];
      const paths = {
        menu: `menu/${account.slug}`,
        product: `menu/${account.slug}/products/${account.productId}`,
        'order-status': `menu/${account.slug}/orders/${account.orderId}/status`,
        dashboard: `shops/${account.shopId}/reports/daily-sales?date=${date}`,
        cashier: `shops/${account.shopId}/orders/${account.orderId}/cashier-review`,
        kitchen: `shops/${account.shopId}/preparation/queue`,
        health: 'health/live',
      };
      const start = performance.now();
      let status = 'network_error',
        ok = false,
        code;
      try {
        const response = await request(paths[kind], {
          localAddress: probe ? '127.0.0.4' : `127.0.0.${10 + (slot % 48)}`,
          headers: ['dashboard', 'cashier', 'kitchen'].includes(kind)
            ? { Authorization: `Bearer ${account.token}` }
            : kind === 'order-status'
              ? { Cookie: account.trackingCookie }
              : {},
        });
        status = String(response.status);
        const data = await response.json();
        ok = response.ok && validMixedSpike(kind, data, account, date);
        if (response.ok && !ok) status = 'invalid_payload';
        if (['429', '503'].includes(status)) {
          const retry = Number(response.headers.get('retry-after'));
          if (!Number.isFinite(retry) || retry <= 0 || retry > 900)
            invalidRetryAfter++;
          if (
            typeof data?.code === 'string' &&
            /^[A-Z_]{1,80}$/u.test(data.code)
          )
            code = data.code;
        }
      } catch {
        if (status === '200') status = 'invalid_payload';
        /* Aggregate-only failures; never retain bodies, tokens or credentials. */
      }
      (probe ? probes : samples).push({
        window: Math.floor((probe ? slot : wave) / p.seconds),
        kind,
        tenant,
        status,
        ok,
        code,
        ms: performance.now() - start,
      });
    }
    function dispatch(kind, slot, wave, deadline, probe = false) {
      if (
        performance.now() - deadline > p.dispatchDelayMs ||
        pending.size >= p.maxInFlight - (probe ? 0 : p.probeReserve)
      ) {
        if (probe) missedProbes++;
        else {
          missed++;
          missedWindows[Math.floor(wave / p.seconds)]++;
          missedByKind[kind]++;
        }
        return;
      }
      const task = measure(kind, slot, wave, probe).finally(() =>
        pending.delete(task),
      );
      pending.add(task);
      report.peakInFlight = Math.max(report.peakInFlight, pending.size);
    }
    await Promise.all([
      (async () => {
        for (let i = 0; i < offeredRps * seconds; i++) {
          const deadline = began + (i * 1000) / offeredRps;
          await sleep(Math.max(0, deadline - performance.now()));
          dispatch(
            capacityKinds[i % 4],
            i,
            Math.floor(i / offeredRps),
            deadline,
          );
        }
      })(),
      (async () => {
        for (let second = 0; second < seconds; second++) {
          const deadline = began + second * 1000;
          await sleep(Math.max(0, deadline - performance.now()));
          for (const kind of ['health', 'cashier', 'kitchen'])
            dispatch(kind, second, 0, deadline, true);
        }
      })(),
    ]);
    await sleep(Math.max(0, began + seconds * 1000 - performance.now()));
    await Promise.all(pending);
    const result = {
      role,
      phase: name,
      offeredRps,
      seconds,
      ...summarize(samples, seconds, missed),
      windows: missedWindows.map((missedCount, index) => ({
        index,
        ...summarize(
          samples.filter((s) => s.window === index),
          p.seconds,
          missedCount,
        ),
      })),
      elapsedSeconds: (performance.now() - began) / 1000,
      goodputRps:
        samples.filter((s) => s.ok).length /
        ((performance.now() - began) / 1000),
      achievedRps: samples.length / ((performance.now() - began) / 1000),
      rejectionTimings: summarize(
        samples
          .filter((s) => ['429', '503'].includes(s.status))
          .map((s) => ({ ...s, ok: true })),
        seconds,
      ),
      byKind: Object.fromEntries(
        capacityKinds.map((kind) => [
          kind,
          summarize(
            samples.filter((s) => s.kind === kind),
            seconds,
            missedByKind[kind],
          ),
        ]),
      ),
      codeCounts: samples.reduce((a, s) => {
        if (s.code) a[s.code] = (a[s.code] ?? 0) + 1;
        return a;
      }, {}),
      probes,
      missedProbes,
      invalidRetryAfter,
    };
    result.verdict = capacityStageVerdict(result);
    report.stages.push(result);
    await hooks.onStage({ phase: name, type: 'complete' });
    await checkpoint();
    return result;
  }
  try {
    for (const account of accounts) await auth('login', account);
    await phase('capacity-warmup');
    for (let second = 0; second < p.warmSeconds; second++) {
      const response = await request(`menu/${accounts[second % 3].slug}`, {
        localAddress: '127.0.0.5',
      });
      await response.arrayBuffer();
      assert.ok(response.ok);
      await sleep(1000);
    }
    for (const [index, rps] of p.levels.entries()) {
      const result = await stage('level', rps, index);
      if (!result.verdict.sloPass) {
        if (!result.verdict.valid || result.verdict.unexpected) break;
        await stage('confirmation', rps, index);
        break;
      }
    }
    await phase('capacity-recovery-wait');
    const until = performance.now() + p.recoveryWaitSeconds * 1000;
    while (performance.now() < until) {
      const began = performance.now();
      const response = await request('health/live', {
        localAddress: '127.0.0.4',
      });
      const data = await response.json();
      report.controls.push({
        kind: 'recovery-health',
        ok: response.ok && data.api === 'ok',
        ms: performance.now() - began,
      });
      await sleep(Math.min(5000, Math.max(0, until - performance.now())));
    }
    await stage('recovery', p.levels[0], 0);
    const headroomRps = capacityConclusion(report.stages).candidatePlanningRps;
    if (headroomRps) await stage('headroom', headroomRps, 0, p.headroomSeconds);
    for (const account of accounts) await auth('logout', account);
    await phase('capacity-idle');
    await sleep(p.idleSeconds * 1000);
    await hooks.onStage({ phase: 'capacity-idle', type: 'complete' });
    report.conclusion = capacityConclusion(report.stages);
    report.complete = true;
  } finally {
    await Promise.allSettled(pending);
    for (const cookie of sessions) {
      try {
        await auth('logout', { cookie });
      } catch {
        /* Cleanup fails acceptance. */
      }
    }
    report.finishedAt = new Date().toISOString();
    await checkpoint();
  }
  return report;
}
