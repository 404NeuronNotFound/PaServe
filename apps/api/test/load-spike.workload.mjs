import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';
import { validSpikeMenu, validSpikeDetail } from './menu-spike.workload.mjs';
import { validateRampResponse } from './load-ramp.client-workload.mjs';
import {
  overloadSpikeProfile,
  runSpikeOverload,
} from './load-spike.overload.mjs';

export const spikeProfile = Object.freeze({
  version: 2,
  levels: Object.freeze([2, 24, 2]),
  phases: Object.freeze(['baseline', 'spike', 'recovery']),
  seconds: 8,
  waveMs: 1000,
  launchSpreadMs: 100,
  dispatchDelayMs: 150,
  maxInFlight: 64,
  p95Ms: 1000,
  p99Ms: 1500,
  criticalMs: 1000,
  requestTimeoutMs: 5000,
  recoveryMs: 1500,
  overload: overloadSpikeProfile,
});
export const spikeKinds = ['menu', 'product', 'order-status', 'dashboard'];
export function validMixedSpike(kind, data, account, date) {
  if (kind === 'menu') return validSpikeMenu(data, account, 'AVAILABLE');
  if (kind === 'product') return validSpikeDetail(data, account, 'AVAILABLE');
  if (kind === 'order-status')
    return (
      validateRampResponse(kind, data, account, date) &&
      data.order.status === 'PENDING_CONFIRMATION' &&
      data.order.paymentStatus === 'UNPAID' &&
      data.receipt?.totalPrice === '37.00'
    );
  if (kind === 'cashier')
    return (
      data?.order?.id === account.orderId &&
      data.order.shopId === account.shopId &&
      data.order.status === 'PENDING_CONFIRMATION' &&
      data.order.totalPrice === '37.00'
    );
  if (kind === 'kitchen')
    return (
      Array.isArray(data?.orders) &&
      account.kitchenIds.length > 0 &&
      data.orders.length === account.kitchenIds.length &&
      data.orders.every(
        (o, i) =>
          o.id === account.kitchenIds[i] &&
          o.shopId === account.shopId &&
          o.preparationStatus === 'QUEUED',
      )
    );
  if (kind === 'health') return data?.api === 'ok';
  return validateRampResponse(kind, data, account, date);
}

export async function runTrafficSpike(env, hooks) {
  const { base, fetch } = await connectLoadTarget(env, loopbackTransport);
  const accounts = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(accounts.length, 3);
  const report = {
    version: 2,
    runId: env.LOAD_RUN_ID,
    profile: spikeProfile,
    startedAt: new Date().toISOString(),
    stages: [],
    sessionsCreated: 0,
    sessionsRevoked: 0,
    peakInFlight: 0,
    recoverySpikeDrainMs: null,
  };
  const date = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Manila',
    }),
    sessions = new Set(),
    pending = new Set(),
    active = new Map();
  let recoveryStart, currentPhase;
  const headers = {
    'Content-Type': 'application/json',
    'X-PaServe-Client': 'web',
  };
  const request = (path, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      signal: AbortSignal.timeout(spikeProfile.requestTimeoutMs),
    });
  async function login(account) {
    const response = await request('auth/login', {
      method: 'POST',
      localAddress: '127.0.0.3',
      headers,
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        keepSignedIn: false,
      }),
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (response.ok && cookie) {
      sessions.add(cookie);
      report.sessionsCreated++;
    }
    const text = await response.text();
    return {
      response,
      cookie,
      data: JSON.parse(text),
      bytes: Buffer.byteLength(text),
    };
  }
  async function logout(cookie) {
    const response = await request('auth/logout', {
      method: 'POST',
      localAddress: '127.0.0.3',
      headers: { ...headers, Cookie: cookie },
      body: '{}',
    });
    await response.arrayBuffer();
    if (response.ok) {
      sessions.delete(cookie);
      report.sessionsRevoked++;
    }
  }
  try {
    for (const account of accounts) {
      const session = await login(account);
      assert.ok(
        session.response.ok &&
          session.cookie &&
          session.data.user?.id &&
          session.data.accessToken,
        'Spike setup login failed.',
      );
      account.token = session.data.accessToken;
      account.userId = session.data.user.id;
    }
    const origin = performance.now() + 250;
    for (const [phaseIndex, phase] of spikeProfile.phases.entries()) {
      currentPhase = phase;
      const plannedStart = origin + phaseIndex * spikeProfile.seconds * 1000;
      await sleep(Math.max(0, plannedStart - performance.now()));
      await hooks.onStage({ phase: `traffic-spike-${phase}`, type: 'start' });
      if (phase === 'recovery') {
        recoveryStart = plannedStart;
        if (!(active.get('spike') ?? 0))
          report.recoverySpikeDrainMs = Math.max(
            0,
            performance.now() - plannedStart,
          );
      }
      const stage = {
        phase,
        clients: spikeProfile.levels[phaseIndex],
        samples: [],
        probes: [],
        login: [],
        missed: 0,
        missedProbes: 0,
        waves: [],
        startDelayMs: performance.now() - plannedStart,
      };
      report.stages.push(stage);
      async function measure(kind, client, wave, deadline, probe = false) {
        const account = accounts[(client + wave) % 3],
          began = performance.now();
        let status = 'network_error',
          ok = false,
          bytes = 0,
          cookie,
          retryAfter;
        try {
          if (kind === 'login') {
            const value = await login(account);
            cookie = value.cookie;
            bytes = value.bytes;
            status = String(value.response.status);
            retryAfter = value.response.headers.get('retry-after');
            ok =
              value.response.ok &&
              !!cookie &&
              validateRampResponse('login', value.data, account, date);
          } else {
            const paths = {
              menu: `menu/${account.slug}`,
              product: `menu/${account.slug}/products/${account.productId}`,
              'order-status': `menu/${account.slug}/orders/${account.orderId}/status`,
              dashboard: `shops/${account.shopId}/reports/daily-sales?date=${date}`,
              cashier: `shops/${account.shopId}/orders/${account.orderId}/cashier-review`,
              kitchen: `shops/${account.shopId}/preparation/queue`,
              health: 'health/live',
            };
            const response = await request(paths[kind], {
              localAddress: probe ? '127.0.0.4' : `127.0.0.${10 + client}`,
              headers: ['dashboard', 'cashier', 'kitchen'].includes(kind)
                ? { Authorization: `Bearer ${account.token}` }
                : kind === 'order-status'
                  ? { Cookie: account.trackingCookie }
                  : {},
            });
            status = String(response.status);
            retryAfter = response.headers.get('retry-after');
            const text = await response.text();
            bytes = Buffer.byteLength(text);
            ok =
              response.ok &&
              validMixedSpike(kind, JSON.parse(text), account, date);
          }
          if (!ok && status.startsWith('2')) status = 'invalid_payload';
        } catch {
          /* Aggregate only; never bodies, identity or tokens. */
        }
        const sample = {
          kind,
          client,
          wave,
          tenant: (client + wave) % 3,
          status,
          ok,
          bytes,
          ms: performance.now() - began,
          offsetMs: began - plannedStart,
          dispatchDelayMs: Math.max(0, began - deadline),
          retryAfterSeconds:
            retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null,
        };
        (kind === 'login'
          ? stage.login
          : probe
            ? stage.probes
            : stage.samples
        ).push(sample);
        if (cookie) await logout(cookie);
      }
      function dispatch(kind, client, wave, deadline, probe = false) {
        if (
          performance.now() - deadline > spikeProfile.dispatchDelayMs ||
          pending.size >= spikeProfile.maxInFlight
        ) {
          if (probe) stage.missedProbes++;
          else stage.missed++;
          return;
        }
        active.set(phase, (active.get(phase) ?? 0) + 1);
        const task = measure(kind, client, wave, deadline, probe)
          .catch(() => {})
          .finally(() => {
            pending.delete(task);
            active.set(phase, active.get(phase) - 1);
            if (
              phase === 'spike' &&
              currentPhase === 'recovery' &&
              active.get('spike') === 0
            )
              report.recoverySpikeDrainMs = Math.max(
                0,
                performance.now() - recoveryStart,
              );
          });
        pending.add(task);
        report.peakInFlight = Math.max(report.peakInFlight, pending.size);
      }
      for (let wave = 0; wave < spikeProfile.seconds; wave++) {
        const deadline = plannedStart + wave * spikeProfile.waveMs;
        await sleep(Math.max(0, deadline - performance.now()));
        for (let client = 0; client < stage.clients; client++)
          dispatch(spikeKinds[(client + wave) % 4], client, wave, deadline);
        for (const kind of ['cashier', 'kitchen', 'health'])
          dispatch(kind, 0, wave, deadline, true);
        if (wave === 1) dispatch('login', 0, wave, deadline, true);
      }
      await sleep(
        Math.max(
          0,
          plannedStart + spikeProfile.seconds * 1000 - performance.now(),
        ),
      );
      // Do not drain the spike before starting recovery: late spike work remains
      // measured while the arrival rate returns to baseline at its fixed deadline.
      await hooks.onStage({
        phase: `traffic-spike-${phase}`,
        type: 'complete',
      });
    }
    await Promise.all(pending);
    for (const stage of report.stages) {
      Object.assign(
        stage,
        summarize(stage.samples, spikeProfile.seconds, stage.missed),
      );
      stage.workflows = Object.fromEntries(
        spikeKinds.map((kind) => [
          kind,
          summarize(
            stage.samples.filter((s) => s.kind === kind),
            spikeProfile.seconds,
          ),
        ]),
      );
      stage.waves = Array.from({ length: spikeProfile.seconds }, (_, wave) => {
        const samples = stage.samples.filter((s) => s.wave === wave),
          offsets = samples.map((s) => s.offsetMs);
        return {
          wave,
          scheduled: stage.clients,
          started: samples.length,
          launchSpreadMs: offsets.length
            ? Math.max(...offsets) - Math.min(...offsets)
            : null,
          maximumDispatchDelayMs: samples.length
            ? Math.max(...samples.map((s) => s.dispatchDelayMs))
            : null,
        };
      });
    }
    report.overload = await runSpikeOverload({
      request,
      accounts,
      date,
      hooks,
      validate: validMixedSpike,
      onReport: (value) => {
        report.overload = value;
      },
    });
    report.peakInFlight = Math.max(
      report.peakInFlight,
      report.overload.peakInFlight,
    );
  } finally {
    await Promise.allSettled(pending);
    for (const cookie of sessions) {
      try {
        await logout(cookie);
      } catch {
        /* Fail session cleanup acceptance. */
      }
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
