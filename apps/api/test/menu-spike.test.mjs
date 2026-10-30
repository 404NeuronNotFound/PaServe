import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMenuSpike } from './menu-spike.metrics.mjs';
import {
  menuSpikeProfile,
  menuSpikeStages,
  validSpikeMenu,
  validSpikeDetail,
} from './menu-spike.workload.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';

function fixture() {
  const workload = {
    profile: menuSpikeProfile,
    sessionsCreated: 1,
    sessionsRevoked: 1,
    availabilityRestored: true,
    mutations: ['SOLD_OUT', 'AVAILABLE'].map((target) => ({
      target,
      ok: true,
      status: '200',
      propagationMs: 100,
    })),
    stages: menuSpikeStages.map((phase) => {
      const transition =
        phase === 'sold-out-update' || phase === 'available-update';
      const count = transition ? 32 : phase.endsWith('spike') ? 24 : 10;
      return {
        phase,
        requests: count,
        errorRate: 0,
        p95Ms: 100,
        p99Ms: 200,
        launchSpreadMs: 10,
        samples: Array.from({ length: count }, (_, i) => ({
          ok: true,
          status: '200',
          kind:
            phase === 'detail-spike' || transition
              ? i % 2
                ? 'detail'
                : 'menu'
              : 'menu',
          postCommit: transition && i >= 24,
          expectedStatus:
            phase === 'sold-out-update' ? 'SOLD_OUT' : 'AVAILABLE',
        })),
        probes: ['cashier', 'health'].map((kind) => ({
          kind,
          ok: true,
          ms: 20,
        })),
        tenantCounts: transition
          ? [16, 8, 8]
          : phase === 'mixed-spike' || phase === 'detail-spike'
            ? [8, 8, 8]
            : phase.endsWith('spike')
              ? [0, 0, 24]
              : [4, 3, 3],
      };
    }),
  };
  const monitoring = {
    sampleFailures: 0,
    truncated: false,
    samples: menuSpikeStages.flatMap((phase, index) =>
      [0, 100, 500].map((offset) => ({
        phase: `menu-spike-${phase}`,
        elapsedMs: index * 1000 + offset,
        process: { cpuCoreEquivalent: 1, rssBytes: 1000 },
        database: { connections: 7 },
        api: {
          pool: { policy: { max: 5, maxWaiting: 20 }, total: 5, waiting: 0 },
          menuCache: { inFlight: 0, bytes: 1000 },
          menuGate: { active: 4, waiting: 0 },
        },
      })),
    ),
  };
  const evidence = {
    ordersUnchanged: true,
    usersUnchanged: true,
    sessionRows: 1,
    revokedRows: 1,
    availabilityRestored: true,
    cache: Object.fromEntries(
      menuSpikeStages.map((phase) => {
        const before = {
          hits: 0,
          misses: 0,
          coalesced: 0,
          loadErrors: 0,
          bypassed: 0,
          inFlight: 0,
          entries: 3,
        };
        const after = {
          ...before,
          ...(phase === 'cold-spike'
            ? { misses: 1, coalesced: 23 }
            : phase === 'mixed-spike'
              ? { misses: 3, coalesced: 21 }
              : phase.endsWith('update')
                ? { misses: 1, hits: 15 }
                : { hits: phase === 'warm-spike' ? 24 : 10 }),
        };
        return [
          phase,
          {
            before,
            after,
            revisionChanged: phase.endsWith('update'),
            explicitlyCleared: ['cold-spike', 'mixed-spike'].includes(phase),
          },
        ];
      }),
    ),
  };
  return { workload, monitoring, evidence };
}

await test('menu spike requires synchronous bursts, all responses, healthy critical reads and bounded cache loads', () => {
  const f = fixture();
  assert.equal(
    evaluateMenuSpike(f.workload, f.monitoring, f.evidence).pass,
    true,
  );
});
for (const [name, mutate] of [
  [
    'not all phases completed',
    (f) => {
      f.workload.stages.pop();
    },
  ],
  [
    'one rejected menu',
    (f) => {
      f.workload.stages[1].samples[0].ok = false;
    },
  ],
  [
    'not simultaneous',
    (f) => {
      f.workload.stages[1].launchSpreadMs = 101;
    },
  ],
  [
    'latency exceeded',
    (f) => {
      f.workload.stages[1].p99Ms = 1501;
    },
  ],
  [
    'cashier unusable',
    (f) => {
      f.workload.stages[1].probes[0].ok = false;
    },
  ],
  [
    'cache stampede',
    (f) => {
      f.evidence.cache['cold-spike'].after.misses = 24;
    },
  ],
  [
    'warm cache missed',
    (f) => {
      f.evidence.cache['warm-spike'].after.hits = 0;
    },
  ],
  [
    'wrong tenant distribution',
    (f) => {
      f.workload.stages[3].tenantCounts = [0, 0, 24];
    },
  ],
  [
    'monitoring failed',
    (f) => {
      f.monitoring.sampleFailures = 1;
    },
  ],
  [
    'pool limit exceeded',
    (f) => {
      f.monitoring.samples[3].api.pool.total = 6;
    },
  ],
  [
    'session not revoked',
    (f) => {
      f.workload.sessionsRevoked = 0;
    },
  ],
  [
    'unexpected business write',
    (f) => {
      f.evidence.ordersUnchanged = false;
    },
  ],
])
  await test(`menu spike refuses acceptance for ${String(name)}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(
      evaluateMenuSpike(f.workload, f.monitoring, f.evidence).pass,
      false,
    );
  });

await test('availability checks reject stale reads, missing DB revision changes, missing detail traffic and failed restoration', () => {
  for (const change of [
    (f) => {
      f.workload.stages.find(
        (s) => s.phase === 'sold-out-update',
      ).samples[24].expectedStatus = 'AVAILABLE';
    },
    (f) => {
      f.evidence.cache['sold-out-update'].revisionChanged = false;
    },
    (f) => {
      f.evidence.cache['sold-out-update'].explicitlyCleared = true;
    },
    (f) => {
      f.evidence.cache['sold-out-update'].before.entries = 0;
    },
    (f) => {
      f.workload.mutations[0].propagationMs = 1001;
    },
    (f) => {
      f.workload.availabilityRestored = false;
    },
    (f) => {
      f.evidence.availabilityRestored = false;
    },
    (f) => {
      f.workload.stages
        .find((s) => s.phase === 'detail-spike')
        .samples.forEach((s) => {
          s.kind = 'menu';
        });
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(
      evaluateMenuSpike(f.workload, f.monitoring, f.evidence).pass,
      false,
    );
  }
});

await test('menu category identity and sold-out flags, product details and modifier scope are verified', () => {
  const shop = {
    slug: 'synthetic',
    productId: 'p',
    menuProductIds: ['p'],
    categoryIds: ['c'],
    variantId: 'v',
    addOnId: 'a',
  };
  const menu = {
    shop: { slug: 'synthetic' },
    categories: [{ id: 'c' }],
    products: [{ id: 'p', status: 'SOLD_OUT', isOrderable: false }],
  };
  assert.equal(validSpikeMenu(menu, shop, 'SOLD_OUT'), true);
  assert.equal(validSpikeMenu(menu, shop, 'AVAILABLE'), false);
  assert.equal(
    validSpikeMenu(
      { ...menu, categories: [{ id: 'other-tenant' }] },
      shop,
      'SOLD_OUT',
    ),
    false,
  );
  const details = {
    product: {
      id: 'p',
      categoryId: 'c',
      status: 'SOLD_OUT',
      isOrderable: false,
    },
    optionGroups: [],
    variants: [{ id: 'v' }],
    addOns: [{ id: 'a' }],
  };
  assert.equal(validSpikeDetail(details, shop, 'SOLD_OUT'), true);
  assert.equal(validSpikeDetail(details, shop, 'AVAILABLE'), false);
  assert.equal(
    validSpikeDetail(
      { ...details, variants: [{ id: 'other-tenant' }] },
      shop,
      'SOLD_OUT',
    ),
    false,
  );
});

await test('public pages match the expected tenant and complete bounded page without duplicates', () => {
  const shop = { slug: 'synthetic-a', menuProductIds: ['a', 'b'] };
  assert.equal(
    validSpikeMenu(
      { shop: { slug: shop.slug }, products: [{ id: 'a' }, { id: 'b' }] },
      shop,
    ),
    true,
  );
  for (const value of [
    { shop: { slug: 'synthetic-b' }, products: [{ id: 'a' }, { id: 'b' }] },
    { shop: { slug: shop.slug }, products: [{ id: 'a' }, { id: 'a' }] },
    {
      shop: { slug: shop.slug },
      products: [{ id: 'a' }, { id: 'other-tenant' }],
    },
    { shop: { slug: shop.slug }, products: [] },
  ])
    assert.equal(validSpikeMenu(value, shop), false);
});

await test('only the owned runner enables menu spike mode', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'fixture-directory',
    report: 'fixture-report',
  };
  assert.equal(
    loadFixtureEnvironment({ LOAD_MENU_SPIKE: '1' }, options).LOAD_MENU_SPIKE,
    '0',
  );
  assert.equal(
    loadFixtureEnvironment({}, { ...options, menuSpike: true }).LOAD_MENU_SPIKE,
    '1',
  );
});
