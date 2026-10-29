import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { rampProfile, rampDiagnosticProfile } from './load-ramp.mjs';

export const rampWorkflows = ['menu', 'login', 'dashboard', 'order-status'];

export function validateRampResponse(kind, data, account, date) {
  if (kind === 'menu')
    return (
      data?.shop?.slug === account.slug &&
      Array.isArray(data.products) &&
      data.products.length > 0 &&
      data.products.length <= 100 &&
      data.products.every((p) => account.menuProductIds.includes(p.id))
    );
  if (kind === 'dashboard')
    return (
      data?.shopId === account.shopId &&
      data.businessDate === date &&
      typeof data.totalSales === 'string' &&
      Number.isSafeInteger(data.completedOrders)
    );
  if (kind === 'order-status')
    return (
      data?.order?.shopId === account.shopId &&
      data.order.id === account.orderId &&
      typeof data.order.status === 'string'
    );
  return (
    typeof data?.accessToken === 'string' && data.user?.id === account.userId
  );
}

/** Only callable by the private driver; all traffic uses the shared target proof. */
export async function runMixedRamp(env, hooks) {
  const { base, fetch } = await connectLoadTarget(env);
  const profile =
    env.LOAD_RAMP_DIAGNOSTIC === '1' ? rampDiagnosticProfile : rampProfile;
  const credentials = JSON.parse(
    await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'),
  );
  assert.equal(credentials.length, 3);
  const date = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Manila',
  });
  const sessions = new Set();
  const headers = {
    'Content-Type': 'application/json',
    'X-PaServe-Client': 'web',
  };
  const report = {
    version: 2,
    environment: 'disposable-development',
    workload: { ...profile, date, workflows: rampWorkflows },
    identities: 3,
    shops: 3,
    stages: [],
    startedAt: new Date().toISOString(),
  };
  const request = (path, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
  async function login(account) {
    const response = await request('auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        keepSignedIn: false,
      }),
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie && response.ok) sessions.add(cookie);
    const data = await response.json();
    return { response, cookie, data };
  }
  async function logout(cookie) {
    const response = await request('auth/logout', {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
      body: '{}',
    });
    await response.arrayBuffer();
    if (response.ok) {
      sessions.delete(cookie);
      report.testSessionsRevoked++;
    }
    return response.ok;
  }
  report.testSessionsCreated = 0;
  report.testSessionsRevoked = 0;
  try {
    for (const account of credentials) {
      const session = await login(account);
      if (session.cookie && session.response.ok) report.testSessionsCreated++;
      assert.ok(
        session.response.ok &&
          session.cookie &&
          typeof session.data.accessToken === 'string',
        'Fixture login failed.',
      );
      account.token = session.data.accessToken;
      account.userId = session.data.user.id;
      assert.ok(
        account.slug && account.orderId && account.trackingCookie,
        'Missing synthetic tracking proof.',
      );
    }
    for (const [stageIndex, clients] of profile.levels.entries()) {
      await hooks.onStage({ type: 'start', virtualClients: clients });
      const startedAt = new Date().toISOString(),
        start = performance.now(),
        end = start + profile.stageSeconds * 1000;
      const samples = [],
        missed = Object.fromEntries(rampWorkflows.map((k) => [k, 0]));
      async function measured(kind, account) {
        const began = performance.now();
        let status = 'network_error',
          ok = false,
          cleanupCookie;
        try {
          if (kind === 'login') {
            const session = await login(account);
            cleanupCookie = session.cookie;
            if (session.cookie && session.response.ok)
              report.testSessionsCreated++;
            status = String(session.response.status);
            ok =
              session.response.ok &&
              !!session.cookie &&
              validateRampResponse(kind, session.data, account, date);
          } else {
            const path =
              kind === 'menu'
                ? `menu/${account.slug}`
                : kind === 'dashboard'
                  ? `shops/${account.shopId}/reports/daily-sales?date=${date}`
                  : `menu/${account.slug}/orders/${account.orderId}/status`;
            const response = await request(path, {
              headers:
                kind === 'menu'
                  ? {}
                  : kind === 'dashboard'
                    ? { Authorization: `Bearer ${account.token}` }
                    : { Cookie: account.trackingCookie },
            });
            status = String(response.status);
            if (response.ok)
              ok = validateRampResponse(
                kind,
                await response.json(),
                account,
                date,
              );
            else await response.arrayBuffer();
          }
          if (!ok && status.startsWith('2')) status = 'invalid_payload';
        } catch {
          /* Aggregate failures without response bodies or credentials. */
        }
        samples.push({ kind, status, ok, ms: performance.now() - began });
        if (cleanupCookie && sessions.has(cleanupCookie))
          await logout(cleanupCookie);
      }
      async function stream(client, kind, interval) {
        let next = start + (client / clients) * interval,
          sequence = 0;
        while (next < end) {
          await sleep(Math.max(0, next - performance.now()));
          if (performance.now() >= end) {
            missed[kind] += Math.ceil((end - next) / interval);
            break;
          }
          await measured(
            kind,
            credentials[(client + sequence++) % credentials.length],
          );
          next += interval;
          const skipped = Math.min(
            Math.max(0, Math.ceil((performance.now() - next) / interval)),
            Math.max(0, Math.ceil((end - next) / interval)),
          );
          missed[kind] += skipped;
          next += skipped * interval;
        }
      }
      await Promise.all([
        ...Array.from({ length: clients }, (_, client) =>
          Promise.all([
            stream(client, 'menu', profile.menuEveryMs),
            stream(client, 'dashboard', profile.dashboardEveryMs),
            stream(client, 'order-status', profile.statusEveryMs),
          ]),
        ),
        (async () => {
          await sleep(15000);
          await measured('login', credentials[stageIndex % 3]);
        })(),
      ]);
      await sleep(Math.max(0, end - performance.now()));
      const elapsedSeconds = (performance.now() - start) / 1000;
      const byWorkflow = Object.fromEntries(
        rampWorkflows.map((kind) => [
          kind,
          {
            ...summarize(
              samples.filter((s) => s.kind === kind),
              elapsedSeconds,
              missed[kind],
            ),
            sampleSufficient:
              samples.filter((s) => s.kind === kind).length >= 100,
          },
        ]),
      );
      const stats = summarize(
        samples,
        elapsedSeconds,
        Object.values(missed).reduce((a, b) => a + b, 0),
      );
      const within = (s) =>
        s.successes > 0 &&
        s.p95Ms <= profile.p95Ms &&
        s.p99Ms <= profile.p99Ms &&
        s.errorRate <= profile.maximumErrorRate &&
        s.missedRate <= profile.maximumMissedRate;
      const stage = {
        virtualClients: clients,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
        ...stats,
        byWorkflow,
        sloPass: within(stats) && Object.values(byWorkflow).every(within),
        sampleSufficient: stats.requests >= profile.minimumSamples,
      };
      report.stages.push(stage);
      await hooks.onStage({ type: 'complete', virtualClients: clients });
      if (!stage.sloPass || !stage.sampleSufficient) break;
    }
  } finally {
    await Promise.allSettled([...sessions].map(logout));
    report.finishedAt = new Date().toISOString();
    await writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
