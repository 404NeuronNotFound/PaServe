import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';

export const orderBurstProfile = Object.freeze({
  version: 2,
  multiClients: 12,
  hotClients: 8,
  duplicateClients: 8,
  maxAttempts: 8,
  p95Ms: 5000,
  p99Ms: 8000,
  launchSpreadMs: 100,
  uniqueOrders: 27,
  staffSessions: 4,
  probeRounds: 2,
  probeBudgetMs: 1000,
});
export const orderBurstStages = [
  'baseline',
  'multi-burst',
  'hot-burst',
  'duplicates',
  'recovery',
];

export function retryableOrder(status, code) {
  return (
    (status === '409' && code === 'ORDER_RETRY_REQUIRED') ||
    status === 'network_error' ||
    status === 'simulated_response_loss'
  );
}
export function validOrderProbe(kind, data, staff, expected) {
  if (kind === 'health') return data?.api === 'ok';
  if (kind === 'cashier')
    return (
      data?.order?.id === expected?.id &&
      data.order.shopId === staff.shopId &&
      data.order.orderNumber === expected.orderNumber &&
      data.order.status === 'PENDING_CONFIRMATION' &&
      data.order.paymentStatus === 'UNPAID' &&
      data.order.totalPrice === '37.00' &&
      data.payment === null
    );
  const orders = data?.orders;
  return (
    Array.isArray(orders) &&
    staff.kitchenIds.length > 0 &&
    orders.length === staff.kitchenIds.length &&
    orders.every(
      (order, i) =>
        order.id === staff.kitchenIds[i] &&
        order.shopId === staff.shopId &&
        order.preparationStatus === 'QUEUED' &&
        order.currency === 'PHP' &&
        order.totalPrice === '37.00' &&
        Array.isArray(order.items) &&
        order.items.length === 2,
    )
  );
}
export function validBurstReceipt(order, shop, mode) {
  const lines = order?.items;
  return (
    typeof order?.id === 'string' &&
    /^ORD-\d+$/.test(order.orderNumber) &&
    order.status === 'PENDING_CONFIRMATION' &&
    order.paymentStatus === 'UNPAID' &&
    order.mode === mode &&
    order.currency === 'PHP' &&
    order.totalPrice === '37.00' &&
    order.subtotalPrice === '37.00' &&
    (mode === 'TAKEOUT' ? order.table === null : order.table?.code === 'T1') &&
    Array.isArray(lines) &&
    lines.length === 2 &&
    lines.every(
      (l) =>
        l.productId === shop.productId &&
        l.currency === 'PHP' &&
        l.basePrice === '10.00',
    ) &&
    lines[0].quantity === 2 &&
    lines[0].unitPrice === '13.50' &&
    lines[0].totalPrice === '27.00' &&
    Array.isArray(lines[0].variants) &&
    Array.isArray(lines[0].addOns) &&
    Array.isArray(lines[1].variants) &&
    Array.isArray(lines[1].addOns) &&
    lines[0].variants.length === 1 &&
    lines[0].variants[0].id === shop.variantId &&
    lines[0].addOns.length === 1 &&
    lines[0].addOns[0].id === shop.addOnId &&
    lines[1].quantity === 1 &&
    lines[1].unitPrice === '10.00' &&
    lines[1].totalPrice === '10.00' &&
    lines[1].variants.length === 0 &&
    lines[1].addOns.length === 0
  );
}

export async function runOrderBurst(env, hooks) {
  const { base, fetch } = await connectLoadTarget(env, loopbackTransport);
  const fixture = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(fixture.shops.length, 3);
  const report = {
    version: 2,
    runId: env.LOAD_RUN_ID,
    profile: orderBurstProfile,
    environment: 'disposable-development',
    startedAt: new Date().toISOString(),
    stages: [],
    attempts: [],
    tracking: [],
    negativeChecks: [],
    sessionsCreated: 0,
    sessionsRevoked: 0,
    staffSetup: [],
  };
  const records = [],
    sessions = [];
  const staffTokens = new Map();
  const headers = {
    'Content-Type': 'application/json',
    'X-PaServe-Client': 'web',
  };
  const request = (path, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
  const contexts = [];
  function bodyFor(tenant, mode, key) {
    const shop = fixture.shops[tenant];
    return {
      requestId: key,
      mode,
      reviewedTotal: '37.00',
      ...(mode === 'DINE_IN'
        ? { tableCode: 'T1', tableToken: contexts[tenant] }
        : {}),
      items: [
        {
          productId: shop.productId,
          quantity: 2,
          variantIds: [shop.variantId],
          addOnIds: [shop.addOnId],
        },
        {
          productId: shop.productId,
          quantity: 1,
          variantIds: [],
          addOnIds: [],
          notes: 'Synthetic less ice',
        },
      ],
    };
  }
  try {
    for (const staff of fixture.probeStaff) {
      const login = await request('auth/login', {
        method: 'POST',
        localAddress: '127.0.0.3',
        headers,
        body: JSON.stringify({
          email: staff.email,
          password: staff.password,
          keepSignedIn: false,
        }),
      });
      const value = await login.json(),
        cookie = login.headers.get('set-cookie')?.split(';')[0];
      if (login.ok && cookie) {
        sessions.push(cookie);
        report.sessionsCreated++;
      }
      assert.ok(
        login.ok &&
          cookie &&
          value.user?.id === staff.id &&
          typeof value.accessToken === 'string',
        'Staff setup failed.',
      );
      const identity = await request('auth/me', {
        localAddress: '127.0.0.3',
        headers: { Authorization: `Bearer ${value.accessToken}` },
      });
      const current = await identity.json();
      const verified =
        identity.ok &&
        current.user?.id === staff.id &&
        Array.isArray(current.user?.memberships) &&
        current.user.memberships.some(
          (m) => m.shopId === staff.shopId && m.role === staff.role,
        );
      report.staffSetup.push({
        tenant: staff.tenant,
        role: staff.role,
        status: String(identity.status),
        verified,
      });
      assert.ok(verified, 'Staff role verification failed.');
      staffTokens.set(staff.id, value.accessToken);
    }
    for (const shop of fixture.shops) {
      const response = await request(`menu/${shop.slug}/table/T1`, {
        localAddress: '127.0.0.4',
      });
      const page = await response.json();
      assert.ok(
        response.ok &&
          page.shop?.slug === shop.slug &&
          page.table?.code === 'T1' &&
          typeof page.table.checkoutToken === 'string',
        'Dine-in context unavailable.',
      );
      contexts.push(page.table.checkoutToken);
    }
    for (const [phaseIndex, phase] of orderBurstStages.entries()) {
      await hooks.onStage({ phase: `order-burst-${phase}`, type: 'start' });
      const start = performance.now(),
        deadline = start + 100;
      const samples = [],
        probes = [],
        phaseRecords = [];
      const burst = !['baseline', 'recovery'].includes(phase);
      const count =
        phase === 'multi-burst'
          ? orderBurstProfile.multiClients
          : phase === 'hot-burst'
            ? orderBurstProfile.hotClients
            : phase === 'duplicates'
              ? orderBurstProfile.duplicateClients
              : 3;
      const duplicateKey = randomUUID();
      async function submit(client) {
        const tenant = ['hot-burst', 'duplicates'].includes(phase)
          ? 0
          : client % 3;
        const mode =
          phase === 'duplicates'
            ? 'DINE_IN'
            : client % 2
              ? 'DINE_IN'
              : 'TAKEOUT';
        const key = phase === 'duplicates' ? duplicateKey : randomUUID();
        const body = bodyFor(
          tenant,
          mode,
          phase === 'duplicates' && client % 2 ? key.toUpperCase() : key,
        );
        if (burst) await sleep(Math.max(0, deadline - performance.now()));
        const began = performance.now();
        let ok = false,
          status = 'network_error',
          result,
          trackingCookie,
          discardedAck = false;
        for (
          let attempt = 0;
          attempt < orderBurstProfile.maxAttempts;
          attempt++
        ) {
          const at = performance.now();
          let code;
          try {
            const response = await request(
              `menu/${fixture.shops[tenant].slug}/orders`,
              {
                method: 'POST',
                localAddress: `127.0.0.${10 + phaseIndex * 8 + client}`,
                headers,
                body: JSON.stringify(body),
              },
            );
            status = String(response.status);
            const data = await response.json();
            code = ['ORDER_RETRY_REQUIRED', 'ORDER_REQUEST_CONFLICT'].includes(
              data.code,
            )
              ? data.code
              : undefined;
            trackingCookie = response.headers.get('set-cookie')?.split(';')[0];
            if (
              response.status === 201 &&
              trackingCookie &&
              validBurstReceipt(data.order, fixture.shops[tenant], mode)
            ) {
              if (phase === 'duplicates' && client === 0 && !discardedAck) {
                status = 'simulated_response_loss';
                discardedAck = true;
              } else {
                ok = true;
                result = data.order;
              }
            } else if (response.ok) {
              status = 'invalid_payload';
            }
          } catch {
            status = 'network_error';
          }
          report.attempts.push({
            phase,
            client,
            attempt,
            status,
            code,
            ms: performance.now() - at,
          });
          if (ok || !retryableOrder(status, code)) break;
          if (attempt + 1 < orderBurstProfile.maxAttempts)
            await sleep(
              Math.min(300, 50 * (attempt + 1)) +
                ((client * 17 + attempt * 29) % 70),
            );
        }
        samples.push({
          client,
          tenant,
          mode,
          ok,
          status,
          offsetMs: began - start,
          ms: performance.now() - began,
        });
        if (ok) {
          const record = {
            phase,
            client,
            tenant,
            mode,
            requestId: key.toLowerCase(),
            id: result.id,
            orderNumber: result.orderNumber,
            qrToken: result.qrToken,
            trackingToken: decodeURIComponent(
              trackingCookie.slice(trackingCookie.indexOf('=') + 1),
            ),
          };
          records.push(record);
          phaseRecords.push({ ...record, trackingCookie, body });
        }
      }
      async function probe(kind, staff, round) {
        await sleep(Math.max(0, deadline + round * 150 - performance.now()));
        const began = performance.now();
        const expected = records.find(
          (r) => r.phase === 'baseline' && r.tenant === staff?.tenant,
        );
        let ok = false,
          status = 'network_error';
        try {
          const response = await request(
            kind === 'health'
              ? 'health/live'
              : kind === 'cashier'
                ? `shops/${staff.shopId}/orders/${expected?.id}/cashier-review`
                : `shops/${staff.shopId}/preparation/queue`,
            {
              localAddress: '127.0.0.3',
              headers:
                kind !== 'health'
                  ? { Authorization: `Bearer ${staffTokens.get(staff.id)}` }
                  : {},
            },
          );
          status = String(response.status);
          const data = await response.json();
          ok = response.ok && validOrderProbe(kind, data, staff, expected);
        } catch {
          /* Aggregate only. */
        }
        probes.push({
          kind,
          tenant: staff?.tenant,
          round,
          offsetMs: began - start,
          status,
          ok,
          ms: performance.now() - began,
        });
      }
      if (burst)
        await Promise.all([
          ...Array.from({ length: count }, (_, i) => submit(i)),
          ...Array.from(
            { length: orderBurstProfile.probeRounds },
            (_, round) => [
              ...fixture.probeStaff.map((staff) =>
                probe(
                  staff.role === 'CASHIER' ? 'cashier' : 'kitchen',
                  staff,
                  round,
                ),
              ),
              probe('health', undefined, round),
            ],
          ).flat(),
        ]);
      else for (let client = 0; client < count; client++) await submit(client);
      const elapsed =
        (Math.max(...samples.map((s) => s.offsetMs + s.ms)) -
          Math.min(...samples.map((s) => s.offsetMs))) /
        1000;
      // Fresh tracking reads validate that successful receipts are backed by accessible persisted orders.
      for (const record of phaseRecords.filter(
        (r, i, a) => a.findIndex((v) => v.id === r.id) === i,
      )) {
        const began = performance.now();
        let ok = false,
          status = 'network_error';
        try {
          const response = await request(
            `menu/${fixture.shops[record.tenant].slug}/orders/${record.id}/status`,
            {
              localAddress: '127.0.0.4',
              headers: { Cookie: record.trackingCookie },
            },
          );
          status = String(response.status);
          const data = await response.json();
          ok =
            response.ok &&
            data.order?.id === record.id &&
            data.order.shopId === fixture.shops[record.tenant].shopId &&
            data.order.status === 'PENDING_CONFIRMATION' &&
            data.order.paymentStatus === 'UNPAID' &&
            data.receipt?.totalPrice === '37.00';
        } catch {
          /* No receipt/proof logging. */
        }
        report.tracking.push({
          phase,
          ok,
          status,
          ms: performance.now() - began,
        });
      }
      if (phase === 'duplicates' && phaseRecords.length) {
        const altered = structuredClone(phaseRecords[0].body);
        altered.items[0].quantity = 1;
        const response = await request(`menu/${fixture.shops[0].slug}/orders`, {
          method: 'POST',
          localAddress: '127.0.0.5',
          headers,
          body: JSON.stringify(altered),
        });
        const data = await response.json();
        report.negativeChecks.push({
          kind: 'changed-payload',
          ok: response.status === 409 && data.code === 'ORDER_REQUEST_CONFLICT',
          status: String(response.status),
        });
      }
      await sleep(Math.max(0, 600 - (performance.now() - start)));
      report.stages.push({
        phase,
        samples,
        probes,
        ...summarize(samples, Math.max(0.001, elapsed)),
        requestWindowSeconds: elapsed,
        uniqueOrdersPerSecond:
          new Set(phaseRecords.map((r) => r.id)).size /
          Math.max(0.001, elapsed),
        launchSpreadMs:
          Math.max(...samples.map((s) => s.offsetMs)) -
          Math.min(...samples.map((s) => s.offsetMs)),
        uniqueReceipts: new Set(phaseRecords.map((r) => r.id)).size,
      });
      await hooks.onStage({ phase: `order-burst-${phase}`, type: 'complete' });
      if (samples.some((s) => !s.ok) || probes.some((s) => !s.ok)) break;
    }
    const forbidden = bodyFor(0, 'TAKEOUT', randomUUID());
    for (const item of forbidden.items)
      item.productId = fixture.shops[1].productId;
    const response = await request(`menu/${fixture.shops[0].slug}/orders`, {
      method: 'POST',
      localAddress: '127.0.0.6',
      headers,
      body: JSON.stringify(forbidden),
    });
    const data = await response.json();
    report.negativeChecks.push({
      kind: 'cross-tenant',
      ok: response.status === 404 && data.code === 'PRODUCT_NOT_AVAILABLE',
      status: String(response.status),
    });
    records.push({ invalidRequestId: forbidden.requestId });
  } finally {
    for (const cookie of sessions) {
      try {
        const response = await request('auth/logout', {
          method: 'POST',
          localAddress: '127.0.0.3',
          headers: { ...headers, Cookie: cookie },
          body: '{}',
        });
        await response.arrayBuffer();
        if (response.ok) report.sessionsRevoked++;
      } catch {
        /* Acceptance fails cleanup. */
      }
    }
    await writeFile(env.LOAD_PRIVATE_RESULTS, JSON.stringify(records), {
      flag: 'wx',
      mode: 0o600,
    });
    report.finishedAt = new Date().toISOString();
    await writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
