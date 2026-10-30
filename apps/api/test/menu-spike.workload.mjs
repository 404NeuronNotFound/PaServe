import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectLoadTarget } from '../../../scripts/load-target.mjs';
import { summarize } from '../../../scripts/order-search-load.mjs';
import { loopbackTransport } from './load-loopback-transport.mjs';

export const menuSpikeProfile = Object.freeze({
  version: 2,
  clients: 24,
  baselineRequests: 10,
  recoveryRequests: 10,
  p95Ms: 1000,
  p99Ms: 1500,
  maximumLaunchSpreadMs: 100,
  mutationReaders: 8,
  propagationBudgetMs: 1000,
});
export const menuSpikeStages = [
  'baseline',
  'cold-spike',
  'warm-spike',
  'mixed-spike',
  'detail-spike',
  'sold-out-update',
  'available-update',
  'recovery',
];

export function validSpikeMenu(data, shop, expectedStatus) {
  const categoriesValid =
    !shop.categoryIds ||
    (Array.isArray(data?.categories) &&
      data.categories.length === shop.categoryIds.length &&
      new Set(data.categories.map((c) => c.id)).size ===
        data.categories.length &&
      data.categories.every((c) => shop.categoryIds.includes(c.id)));
  const product = data?.products?.find((p) => p.id === shop.productId);
  const availabilityValid =
    !shop.productId ||
    (!!product &&
      ['AVAILABLE', 'SOLD_OUT'].includes(product.status) &&
      product.isOrderable === (product.status === 'AVAILABLE') &&
      (expectedStatus === undefined || product.status === expectedStatus));
  return (
    categoriesValid &&
    availabilityValid &&
    data?.shop?.slug === shop.slug &&
    Array.isArray(data.products) &&
    data.products.length === shop.menuProductIds.length &&
    data.products.length <= 100 &&
    new Set(data.products.map((p) => p.id)).size === data.products.length &&
    data.products.every((p) => shop.menuProductIds.includes(p.id))
  );
}

export function validSpikeDetail(data, shop, expectedStatus) {
  const p = data?.product;
  return (
    p?.id === shop.productId &&
    shop.categoryIds.includes(p.categoryId) &&
    ['AVAILABLE', 'SOLD_OUT'].includes(p.status) &&
    p.isOrderable === (p.status === 'AVAILABLE') &&
    (expectedStatus === undefined || p.status === expectedStatus) &&
    Array.isArray(data.optionGroups) &&
    Array.isArray(data.variants) &&
    data.variants.length === 1 &&
    data.variants[0].id === shop.variantId &&
    Array.isArray(data.addOns) &&
    data.addOns.length === 1 &&
    data.addOns[0].id === shop.addOnId
  );
}

export async function runMenuSpike(env, hooks) {
  const { base, fetch } = await connectLoadTarget(env, loopbackTransport);
  const fixture = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, 'utf8'));
  assert.equal(fixture.shops.length, 3);
  const request = (path, options = {}) =>
    fetch(new URL(path, base), {
      ...options,
      signal: AbortSignal.timeout(5000),
    });
  const headers = {
    'Content-Type': 'application/json',
    'X-PaServe-Client': 'web',
  };
  const report = {
    version: 2,
    profile: menuSpikeProfile,
    environment: 'disposable-development',
    startedAt: new Date().toISOString(),
    stages: [],
    sessionsCreated: 0,
    sessionsRevoked: 0,
    mutations: [],
    availabilityRestored: true,
  };
  let cookie, token;
  async function changeAvailability(target, expected) {
    const shop = fixture.shops[0],
      start = performance.now();
    const response = await request(
      `shops/${shop.shopId}/products/${shop.productId}/${target === 'SOLD_OUT' ? 'sold-out' : 'available'}`,
      {
        method: 'PATCH',
        localAddress: '127.0.0.3',
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expectedStatus: expected }),
      },
    );
    const value = await response.json();
    const ok =
      response.ok &&
      value.product?.id === shop.productId &&
      value.product.status === target;
    if (ok) report.availabilityRestored = target === 'AVAILABLE';
    return {
      ok,
      status: String(response.status),
      target,
      expected,
      ms: performance.now() - start,
    };
  }
  try {
    const login = await request('auth/login', {
      method: 'POST',
      localAddress: '127.0.0.3',
      headers,
      body: JSON.stringify({
        email: fixture.staff.email,
        password: fixture.staff.password,
        keepSignedIn: false,
      }),
    });
    const data = await login.json();
    cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (login.ok && cookie) report.sessionsCreated++;
    assert.ok(
      login.ok &&
        cookie &&
        data.user?.id === fixture.staff.id &&
        typeof data.accessToken === 'string',
      'Synthetic cashier login failed.',
    );
    token = data.accessToken;
    for (const phase of menuSpikeStages) {
      await hooks.onStage({
        type: 'start',
        phase: `menu-spike-${phase}`,
        clearMenuCache: ['cold-spike', 'mixed-spike'].includes(phase),
      });
      const start = performance.now(),
        deadline = start + 100;
      const samples = [],
        probes = [];
      const spike = phase.endsWith('spike');
      const transition =
        phase === 'sold-out-update' || phase === 'available-update';
      let committedStatus;
      const count = spike
        ? menuSpikeProfile.clients
        : phase === 'baseline'
          ? menuSpikeProfile.baselineRequests
          : menuSpikeProfile.recoveryRequests;
      async function menu(client, postCommit = false) {
        const mixed =
          phase === 'mixed-spike' ||
          phase === 'detail-spike' ||
          transition ||
          !spike;
        const shop = postCommit
          ? fixture.shops[0]
          : mixed
            ? fixture.shops[client % 3]
            : fixture.shops[2];
        const kind =
          (phase === 'detail-spike' || transition) && client % 2
            ? 'detail'
            : 'menu';
        if (spike || (transition && !postCommit))
          await sleep(
            Math.max(
              0,
              deadline + (transition ? client * 50 : 0) - performance.now(),
            ),
          );
        const began = performance.now();
        const expectedStatus =
          shop === fixture.shops[0] && transition
            ? committedStatus
            : 'AVAILABLE';
        let ok = false,
          status = 'network_error',
          bytes = 0;
        try {
          const response = await request(
            kind === 'menu'
              ? `menu/${shop.slug}`
              : `menu/${shop.slug}/products/${shop.productId}`,
            {
              localAddress: `127.0.0.${(client % menuSpikeProfile.clients) + 10}`,
            },
          );
          status = String(response.status);
          const body = await response.text();
          bytes = Buffer.byteLength(body);
          if (response.ok) {
            ok =
              !response.headers.has('set-cookie') &&
              (kind === 'menu'
                ? validSpikeMenu(JSON.parse(body), shop, expectedStatus)
                : response.headers.get('cache-control')?.includes('no-store') &&
                  validSpikeDetail(JSON.parse(body), shop, expectedStatus));
            if (!ok) status = 'invalid_payload';
          }
        } catch {
          /* Aggregate failure without body or tenant identifiers. */
        }
        samples.push({
          client,
          kind,
          postCommit,
          expectedStatus,
          tenant: fixture.shops.indexOf(shop),
          offsetMs: began - start,
          ms: performance.now() - began,
          status,
          ok,
          bytes,
        });
      }
      async function probe(kind) {
        await sleep(Math.max(0, deadline - performance.now()));
        const began = performance.now();
        let ok = false,
          status = 'network_error';
        try {
          const response = await request(
            kind === 'cashier' ? 'auth/me' : 'health/live',
            {
              localAddress: '127.0.0.3',
              headers:
                kind === 'cashier' ? { Authorization: `Bearer ${token}` } : {},
            },
          );
          status = String(response.status);
          const value = await response.json();
          ok =
            response.ok &&
            (kind === 'cashier'
              ? value.user?.id === fixture.staff.id &&
                value.user.memberships.some(
                  (m) =>
                    m.shopId === fixture.staff.shopId && m.role === 'CASHIER',
                )
              : value.api === 'ok');
        } catch {
          /* No private response content in metrics. */
        }
        probes.push({
          kind,
          status,
          ok,
          offsetMs: began - start,
          ms: performance.now() - began,
        });
      }
      if (transition) {
        await Promise.all([
          ...Array.from({ length: menuSpikeProfile.clients }, (_, client) =>
            menu(client),
          ),
          probe('cashier'),
          probe('health'),
          (async () => {
            await sleep(Math.max(0, deadline + 250 - performance.now()));
            const mutation = await changeAvailability(
              phase === 'sold-out-update' ? 'SOLD_OUT' : 'AVAILABLE',
              phase === 'sold-out-update' ? 'AVAILABLE' : 'SOLD_OUT',
            );
            report.mutations.push(mutation);
            if (!mutation.ok) return;
            committedStatus = mutation.target;
            const committedAt = performance.now();
            await Promise.all(
              Array.from(
                { length: menuSpikeProfile.mutationReaders },
                (_, client) => menu(client, true),
              ),
            );
            mutation.propagationMs = performance.now() - committedAt;
          })(),
        ]);
      } else if (spike)
        await Promise.all([
          ...Array.from({ length: count }, (_, client) => menu(client)),
          probe('cashier'),
          probe('health'),
        ]);
      else
        for (let client = 0; client < count; client++) {
          await menu(client);
          await sleep(100);
        }
      const requestWindowSeconds =
        (Math.max(...samples.map((s) => s.offsetMs + s.ms)) -
          Math.min(...samples.map((s) => s.offsetMs))) /
        1000;
      // Keep the phase visible for resource collection without inflating burst throughput.
      await sleep(Math.max(0, 600 - (performance.now() - start)));
      const stats = summarize(samples, Math.max(0.001, requestWindowSeconds));
      const launch = samples.map((s) => s.offsetMs);
      report.stages.push({
        phase,
        samples,
        probes,
        ...stats,
        requestWindowSeconds,
        launchSpreadMs: Math.max(...launch) - Math.min(...launch),
        tenantCounts: [0, 1, 2].map(
          (tenant) => samples.filter((s) => s.tenant === tenant).length,
        ),
        responseBytes: samples.reduce((n, s) => n + s.bytes, 0),
        byReadKind: Object.fromEntries(
          ['menu', 'detail']
            .filter((kind) => samples.some((s) => s.kind === kind))
            .map((kind) => [
              kind,
              summarize(
                samples.filter((s) => s.kind === kind),
                Math.max(0.001, requestWindowSeconds),
              ),
            ]),
        ),
        sampleSufficient: samples.length >= 100,
      });
      await hooks.onStage({ type: 'complete', phase: `menu-spike-${phase}` });
      if (
        samples.some((s) => !s.ok) ||
        probes.some((s) => !s.ok) ||
        (transition && !report.mutations.at(-1)?.ok)
      )
        break;
    }
  } finally {
    if (!report.availabilityRestored && token) {
      try {
        report.cleanupRestore = await changeAvailability(
          'AVAILABLE',
          'SOLD_OUT',
        );
      } catch {
        /* The failed scenario remains non-passing; owned DB is removed. */
      }
    }
    if (cookie) {
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
        /* Acceptance checks cleanup. */
      }
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(env.LOAD_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
