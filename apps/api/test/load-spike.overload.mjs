import { setTimeout as sleep } from 'node:timers/promises';
import { validSpikeMenu } from './menu-spike.workload.mjs';

export const overloadSpikeProfile = Object.freeze({
  menuClients: 48,
  refreshAttempts: 20,
  refreshBurstLimit: 10,
  refreshWindowMs: 10000,
  recoveryWaves: 8,
  rejectionMs: 1000,
  maximumRetryAfterSeconds: 10,
  launchSpreadMs: 100,
});

export async function runSpikeOverload({
  request,
  accounts,
  date,
  hooks,
  validate,
  onReport,
}) {
  const profile = overloadSpikeProfile;
  const report = {
    profile,
    menus: [],
    rate: [],
    probes: [],
    recovery: [],
    peakInFlight: 0,
  };
  onReport?.(report);
  let inFlight = 0,
    lastRateAt;
  async function measured(path, options = {}) {
    const began = performance.now();
    inFlight++;
    report.peakInFlight = Math.max(report.peakInFlight, inFlight);
    let sample = {
        status: 'network_error',
        ms: 0,
        code: null,
        retryAfterSeconds: null,
        noStore: false,
      },
      data;
    try {
      const response = await request(path, options);
      const text = await response.text();
      data = JSON.parse(text);
      const retry = response.headers.get('retry-after');
      sample = {
        status: String(response.status),
        code: typeof data.code === 'string' ? data.code : null,
        retryAfterSeconds: retry && /^\d+$/.test(retry) ? Number(retry) : null,
        noStore:
          response.headers.get('cache-control')?.includes('no-store') === true,
        offsetMs: began,
      };
    } catch {
      /* Aggregate only; no bodies, credentials, account IDs or IPs. */
    } finally {
      inFlight--;
      sample.ms = performance.now() - began;
    }
    return { sample, data };
  }
  const refresh = () =>
    measured('auth/refresh', {
      method: 'POST',
      localAddress: '127.0.0.60',
      headers: {
        'Content-Type': 'application/json',
        'X-PaServe-Client': 'web',
      },
      body: '{}',
    });
  async function read(kind, tenant) {
    const account = accounts[tenant];
    const paths = {
      menu: `menu/${account.slug}`,
      product: `menu/${account.slug}/products/${account.productId}`,
      'order-status': `menu/${account.slug}/orders/${account.orderId}/status`,
      dashboard: `shops/${account.shopId}/reports/daily-sales?date=${date}`,
      cashier: `shops/${account.shopId}/orders/${account.orderId}/cashier-review`,
      kitchen: `shops/${account.shopId}/preparation/queue`,
      health: 'health/live',
    };
    const result = await measured(paths[kind], {
      localAddress: '127.0.0.4',
      headers: ['dashboard', 'cashier', 'kitchen'].includes(kind)
        ? { Authorization: `Bearer ${account.token}` }
        : kind === 'order-status'
          ? { Cookie: account.trackingCookie }
          : {},
    });
    return {
      ...result.sample,
      kind,
      tenant,
      ok:
        result.sample.status === '200' &&
        validate(kind, result.data, account, date),
    };
  }
  await hooks.onStage({ phase: 'traffic-spike-overload', type: 'start' });
  const started = performance.now(),
    deadline = started + 100;
  const rateTask = (async () => {
    await sleep(Math.max(0, deadline - performance.now()));
    for (let i = 0; i < profile.refreshAttempts; i++) {
      const { sample } = await refresh();
      report.rate.push(sample);
      lastRateAt = performance.now();
    }
  })();
  await Promise.all([
    ...Array.from({ length: profile.menuClients }, async (_, client) => {
      await sleep(Math.max(0, deadline - performance.now()));
      const account = accounts[client % 3];
      const { sample, data } = await measured(`menu/${account.slug}`, {
        localAddress: `127.0.0.${10 + client}`,
      });
      report.menus.push({
        ...sample,
        client,
        tenant: client % 3,
        valid:
          sample.status === '200' && validSpikeMenu(data, account, 'AVAILABLE'),
      });
    }),
    ...[0, 1].flatMap((round) =>
      ['cashier', 'kitchen', 'health'].map(async (kind) => {
        await sleep(Math.max(0, deadline + round * 100 - performance.now()));
        report.probes.push({
          ...(await read(kind, round === 0 ? 0 : 2)),
          round,
        });
      }),
    ),
    rateTask,
  ]);
  const offsets = report.menus.map((s) => s.offsetMs);
  report.launchSpreadMs = offsets.every(Number.isFinite)
    ? Math.max(...offsets) - Math.min(...offsets)
    : null;
  for (const s of [...report.menus, ...report.rate, ...report.probes])
    delete s.offsetMs;
  await sleep(Math.max(0, 600 - (performance.now() - started)));
  await hooks.onStage({ phase: 'traffic-spike-overload', type: 'complete' });
  await hooks.onStage({
    phase: 'traffic-spike-overload-recovery',
    type: 'start',
  });
  const recoveryStart = performance.now();
  const primary = ['menu', 'product', 'order-status', 'dashboard'];
  for (let wave = 0; wave < profile.recoveryWaves; wave++) {
    const at = recoveryStart + wave * 1000;
    await sleep(Math.max(0, at - performance.now()));
    const results = await Promise.all([
      ...[0, 1].map((client) =>
        read(primary[(client + wave) % 4], (client + wave) % 3),
      ),
      ...['cashier', 'kitchen', 'health'].map((kind) => read(kind, wave % 3)),
    ]);
    report.recovery.push(...results.map((sample) => ({ ...sample, wave })));
  }
  const retry = Math.max(
    0,
    ...report.rate.map((s) => s.retryAfterSeconds ?? 0),
  );
  // Respect Retry-After and let the actual rolling burst window expire. No
  // limiter resets, fake time, bucket deletion or retries of rejected traffic.
  if (retry > profile.maximumRetryAfterSeconds)
    throw new Error('Unexpected refresh retry window.');
  await sleep(
    Math.max(
      0,
      lastRateAt +
        Math.max(profile.refreshWindowMs, retry * 1000) +
        100 -
        performance.now(),
    ),
  );
  const recovered = await refresh();
  report.rateRecovery = {
    ...recovered.sample,
    waitedMs: performance.now() - lastRateAt,
  };
  delete report.rateRecovery.offsetMs;
  for (const s of report.recovery) delete s.offsetMs;
  report.durationMs = performance.now() - started;
  await hooks.onStage({
    phase: 'traffic-spike-overload-recovery',
    type: 'complete',
  });
  return report;
}

export function evaluateSpikeOverload(report, proof, monitoring) {
  if (!report || !proof?.before || !proof?.after || !proof?.recovered)
    return { pass: false, checks: { complete: false } };
  const p = overloadSpikeProfile,
    shed = report.menus.filter((s) => s.status === '503'),
    throttled = report.rate.filter((s) => s.status === '429');
  const samples = monitoring.samples.filter(
    (s) =>
      ['traffic-spike-overload', 'traffic-spike-overload-recovery'].includes(
        s.phase,
      ) && s.api,
  );
  const checks = {
    profile: JSON.stringify(report.profile) === JSON.stringify(p),
    menus:
      report.menus.length === 48 &&
      shed.length > 0 &&
      report.menus.some((s) => s.valid) &&
      report.menus.every((s) =>
        s.status === '200'
          ? s.valid
          : s.status === '503' &&
            s.code === 'API_OVERLOADED' &&
            s.noStore &&
            s.retryAfterSeconds === 1 &&
            s.ms <= p.rejectionMs,
      ),
    sudden:
      Number.isFinite(report.launchSpreadMs) &&
      report.launchSpreadMs <= p.launchSpreadMs &&
      report.peakInFlight <= 55,
    rate:
      report.rate.length === 20 &&
      report.rate.every((s, i) =>
        i < 10
          ? s.status === '401' && s.code === 'INVALID_SESSION'
          : s.status === '429' &&
            s.code === 'RATE_LIMIT_EXCEEDED' &&
            s.noStore &&
            s.retryAfterSeconds >= 1 &&
            s.retryAfterSeconds <= 10 &&
            s.ms <= p.rejectionMs,
      ),
    critical:
      report.probes.length === 6 &&
      report.probes.every((s) => s.ok && s.ms <= 1000),
    earlyBackpressure:
      proof.after.gate.rejected - proof.before.gate.rejected === shed.length &&
      proof.after.gate.peakActive <= proof.after.gate.limits.active &&
      proof.after.gate.peakWaiting <= proof.after.gate.limits.waiting &&
      proof.after.capacity.peak < proof.after.capacity.limits.total &&
      proof.after.pool.rejected === proof.before.pool.rejected &&
      proof.after.passwords.started === proof.before.passwords.started,
    recovery:
      report.recovery.length === 40 &&
      report.recovery.every((s) => s.ok && s.ms <= 1000) &&
      report.rateRecovery.status === '401' &&
      report.rateRecovery.code === 'INVALID_SESSION' &&
      report.rateRecovery.ms <= 1000 &&
      report.rateRecovery.waitedMs >= p.refreshWindowMs,
    released:
      proof.recovered.gate.active === 0 &&
      proof.recovered.gate.waiting === 0 &&
      proof.recovered.capacity.active.total === 0 &&
      proof.recovered.pool.waiting === 0 &&
      proof.recovered.passwords.active === 0,
    monitored:
      ['traffic-spike-overload', 'traffic-spike-overload-recovery'].every(
        (phase) => samples.filter((s) => s.phase === phase).length >= 3,
      ) &&
      samples.every(
        (s) =>
          s.api.pool.total <= s.api.pool.policy.max &&
          s.api.pool.waiting <= s.api.pool.policy.maxWaiting &&
          s.database.connections <= s.api.pool.policy.max + 2,
      ),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    shed: shed.length,
    throttled: throttled.length,
    readGateRejectionDelta:
      proof.after.gate.rejected - proof.before.gate.rejected,
    apiPeak: proof.after.capacity.peak,
    apiLimit: proof.after.capacity.limits.total,
    menusSucceeded: report.menus.filter((s) => s.valid).length,
    proof,
  };
}
