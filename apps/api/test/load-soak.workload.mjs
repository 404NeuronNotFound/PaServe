import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';
import { validMixedSpike } from './load-spike.workload.mjs';
import { soakProfile, soakKinds } from './load-soak.profile.mjs';

export async function runSoak(env, hooks) {
  const profile = soakProfile(env.LOAD_SOAK_PROFILE);
  let target = await connectLoadTarget(env, loopbackTransport);
  const accounts = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(accounts.length, 3);
  const sessions = new Set(),
    pending = new Set();
  const report = {
    version: 1,
    runId: env.LOAD_RUN_ID,
    profile,
    startedAt: new Date().toISOString(),
    complete: false,
    windows: [],
    controls: [],
    sessionsCreated: 0,
    sessionsRevoked: 0,
    refreshes: 0,
    churns: 0,
    peakInFlight: 0,
    missed: 0,
  };
  const date = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Manila',
    }),
    headers = { 'Content-Type': 'application/json', 'X-PaServe-Client': 'web' };
  let failed = false;
  const checkpoint = () =>
    writeFile(
      env.LOAD_REPORT,
      JSON.stringify(
        { ...report, checkpointAt: new Date().toISOString() },
        null,
        2,
      ) + '\n',
    );
  const request = (path, options = {}) =>
    target.fetch(new URL(path, target.base), {
      ...options,
      signal: AbortSignal.timeout(profile.requestMs),
    });
  async function control(kind, account) {
    const began = performance.now();
    let ok = false,
      status = 'network_error',
      cookie;
    try {
      const response = await request(`auth/${kind}`, {
        method: 'POST',
        localAddress: kind === 'login' ? '127.0.0.5' : '127.0.0.3',
        headers: {
          ...headers,
          ...(kind !== 'login' ? { Cookie: account.cookie } : {}),
        },
        body:
          kind === 'login'
            ? JSON.stringify({
                email: account.email,
                password: account.password,
                keepSignedIn: false,
              })
            : '{}',
      });
      status = String(response.status);
      cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (kind === 'logout') {
        await response.arrayBuffer();
        ok = response.status === 204;
        if (ok) {
          sessions.delete(account.cookie);
          report.sessionsRevoked++;
        }
      } else {
        if (response.ok && cookie) {
          if (kind === 'refresh') sessions.delete(account.cookie);
          else report.sessionsCreated++;
          sessions.add(cookie);
        }
        const data = await response.json();
        ok =
          response.status === 200 &&
          !!cookie &&
          typeof data.accessToken === 'string' &&
          typeof data.user?.id === 'string' &&
          (!account.userId || data.user.id === account.userId);
        if (response.ok && cookie) {
          account.cookie = cookie;
          account.token = data.accessToken;
          account.userId = data.user?.id;
        }
        if (ok && kind === 'refresh') report.refreshes++;
      }
    } catch {
      /* No bodies or credentials in diagnostics. */
    }
    report.controls.push({ kind, status, ok, ms: performance.now() - began });
    if (!ok) failed = true;
    return ok;
  }
  async function phase(name) {
    await hooks.onStage({ phase: name, type: 'start' });
    // The owning API renews its marker through private IPC. Preserve the same
    // literal origin/run/capability; target proof still expires after 15 minutes.
    target = await connectLoadTarget(env, loopbackTransport);
  }
  async function measured(kind, client, wave, bucket) {
    const account = accounts[(client + Math.floor(wave / 6)) % 3],
      began = performance.now();
    let ok = false,
      status = 'network_error';
    try {
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
        localAddress:
          kind === 'health' ? '127.0.0.4' : `127.0.0.${10 + client}`,
        headers: ['dashboard', 'cashier', 'kitchen'].includes(kind)
          ? { Authorization: `Bearer ${account.token}` }
          : kind === 'order-status'
            ? { Cookie: account.trackingCookie }
            : {},
      });
      status = String(response.status);
      const data = await response.json();
      ok = response.ok && validMixedSpike(kind, data, account, date);
      if (!ok && response.ok) status = 'invalid_payload';
    } catch {
      /* Bounded aggregate measurements only. */
    }
    bucket.samples.push({ kind, status, ok, ms: performance.now() - began });
    if (!ok) failed = true;
  }
  function finish(bucket) {
    if (!bucket.closed || bucket.pending) return;
    const summary = {
      phase: bucket.phase,
      seconds: bucket.seconds,
      scheduled: bucket.seconds * 6,
      missed: bucket.missed,
      ...summarize(
        bucket.samples.filter((s) => s.kind !== 'health'),
        bucket.seconds,
      ),
      byKind: Object.fromEntries(
        [...soakKinds, 'health'].map((kind) => [
          kind,
          summarize(
            bucket.samples.filter((s) => s.kind === kind),
            bucket.seconds,
          ),
        ]),
      ),
    };
    report.windows.push(summary);
    bucket.samples.length = 0; // Raw request timings never accumulate for an hour.
  }
  function dispatch(kind, client, wave, bucket, deadline) {
    if (
      performance.now() - deadline > profile.dispatchDelayMs ||
      pending.size >= profile.maxInFlight
    ) {
      bucket.missed++;
      report.missed++;
      return;
    }
    bucket.pending++;
    const task = measured(kind, client, wave, bucket).finally(() => {
      pending.delete(task);
      bucket.pending--;
      finish(bucket);
    });
    pending.add(task);
    report.peakInFlight = Math.max(report.peakInFlight, pending.size);
  }
  try {
    for (const account of accounts)
      assert.ok(await control('login', account), 'Soak setup failed.');
    let wave = 0;
    for (let index = -1; index < profile.windows; index++) {
      const name = index < 0 ? 'soak-warmup' : `soak-window-${index}`,
        seconds = index < 0 ? profile.warmSeconds : profile.windowSeconds;
      await phase(name);
      const began = performance.now() + 100,
        bucket = {
          phase: name,
          seconds,
          samples: [],
          pending: 0,
          missed: 0,
          closed: false,
        };
      for (let step = 0; step < seconds; step++, wave++) {
        const deadline = began + step * 1000;
        await sleep(Math.max(0, deadline - performance.now()));
        if (failed) throw new Error('Soak workload failed.');
        for (let client = 0; client < 6; client++)
          dispatch(
            soakKinds[(client + wave) % 6],
            client,
            wave,
            bucket,
            deadline,
          );
        if (wave % 5 === 0) dispatch('health', 0, wave, bucket, deadline);
        if (wave > 0 && wave % profile.refreshEverySeconds === 0)
          for (const account of accounts) await control('refresh', account);
        if (wave > 0 && wave % profile.churnEverySeconds === 0) {
          const temporary = {
            ...accounts[Math.floor(wave / profile.churnEverySeconds) % 3],
            userId: undefined,
            cookie: undefined,
          };
          if (await control('login', temporary)) {
            await control('logout', temporary);
            report.churns++;
          }
        }
      }
      await sleep(Math.max(0, began + seconds * 1000 - performance.now()));
      bucket.closed = true;
      finish(bucket);
      await checkpoint();
    }
    await Promise.all(pending);
    for (const account of accounts) await control('logout', account);
    await phase('soak-cooldown');
    const cooldown = performance.now();
    for (let second = 0; second < profile.cooldownSeconds; second += 5) {
      await sleep(Math.max(0, cooldown + second * 1000 - performance.now()));
      const bucket = {
        phase: 'cooldown-health',
        seconds: 5,
        samples: [],
        pending: 0,
        missed: 0,
        closed: false,
      };
      await measured('health', 0, 0, bucket);
      const sample = bucket.samples[0];
      report.controls.push({ ...sample, kind: 'cooldown-health' });
    }
    await sleep(
      Math.max(
        0,
        cooldown + profile.cooldownSeconds * 1000 - performance.now(),
      ),
    );
    await hooks.onStage({ phase: 'soak-cooldown', type: 'complete' });
    report.complete = !failed;
  } catch {
    report.failureCode = 'SOAK_WORKLOAD_FAILED';
  } finally {
    await Promise.allSettled(pending);
    for (const cookie of sessions) await control('logout', { cookie });
    report.finishedAt = new Date().toISOString();
    await checkpoint();
  }
  return report;
}
