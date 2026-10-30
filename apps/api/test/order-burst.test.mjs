import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOrderBurst } from './order-burst.metrics.mjs';
import {
  orderBurstProfile,
  orderBurstStages,
  retryableOrder,
  validBurstReceipt,
  validOrderProbe,
} from './order-burst.workload.mjs';
import {
  instrumentOrderTransactions,
  summarizeOrderTransactions,
} from './order-burst.instrumentation.mjs';
import { loadFixtureEnvironment } from './load-fixture-environment.mjs';

await test('receipt validation rejects wrong tenant products, money, mode and missing modifiers', () => {
  const shop = { productId: 'product', variantId: 'variant', addOnId: 'addon' };
  const receipt = {
    id: 'order',
    orderNumber: 'ORD-1',
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    mode: 'TAKEOUT',
    currency: 'PHP',
    totalPrice: '37.00',
    subtotalPrice: '37.00',
    table: null,
    items: [
      {
        productId: 'product',
        currency: 'PHP',
        basePrice: '10.00',
        quantity: 2,
        unitPrice: '13.50',
        totalPrice: '27.00',
        variants: [{ id: 'variant' }],
        addOns: [{ id: 'addon' }],
      },
      {
        productId: 'product',
        currency: 'PHP',
        basePrice: '10.00',
        quantity: 1,
        unitPrice: '10.00',
        totalPrice: '10.00',
        variants: [],
        addOns: [],
      },
    ],
  };
  assert.equal(validBurstReceipt(receipt, shop, 'TAKEOUT'), true);
  for (const mutate of [
    (r) => {
      r.items[0].productId = 'foreign';
    },
    (r) => {
      r.totalPrice = '36.00';
    },
    (r) => {
      r.items[0].variants = undefined;
    },
    (r) => {
      r.mode = 'DINE_IN';
    },
  ]) {
    const invalid = structuredClone(receipt);
    mutate(invalid);
    assert.equal(validBurstReceipt(invalid, shop, 'TAKEOUT'), false);
  }
  receipt.mode = 'DINE_IN';
  receipt.table = { code: 'T1' };
  assert.equal(validBurstReceipt(receipt, shop, 'DINE_IN'), true);
  receipt.table.code = 'T2';
  assert.equal(validBurstReceipt(receipt, shop, 'DINE_IN'), false);
});

function fixture() {
  const workload = {
    profile: orderBurstProfile,
    sessionsCreated: 4,
    sessionsRevoked: 4,
    stages: orderBurstStages.map((phase) => {
      const count =
        phase === 'multi-burst'
          ? 12
          : ['baseline', 'recovery'].includes(phase)
            ? 3
            : 8;
      return {
        phase,
        requests: count,
        samples: Array.from({ length: count }, () => ({
          ok: true,
          status: '201',
          offsetMs: 100,
          ms: 500,
        })),
        errorRate: 0,
        p95Ms: 100,
        p99Ms: 200,
        launchSpreadMs: 10,
        uniqueReceipts: phase === 'duplicates' ? 1 : count,
        probes: [0, 1].flatMap((round) => [
          ...['cashier', 'kitchen'].flatMap((kind) =>
            [0, 2].map((tenant) => ({
              kind,
              tenant,
              round,
              ok: true,
              status: '200',
              offsetMs: 100 + round * 150,
              ms: 20,
            })),
          ),
          {
            kind: 'health',
            round,
            ok: true,
            status: '200',
            offsetMs: 100 + round * 150,
            ms: 20,
          },
        ]),
      };
    }),
    tracking: Array.from({ length: 27 }, () => ({ ok: true, status: '200' })),
    negativeChecks: ['cross-tenant', 'changed-payload'].map((kind) => ({
      kind,
      ok: true,
    })),
  };
  workload.attempts = workload.stages.flatMap((stage) =>
    stage.samples.map((_, client) => ({
      phase: stage.phase,
      client,
      status: '201',
    })),
  );
  workload.attempts.push({
    phase: 'duplicates',
    client: 0,
    status: 'simulated_response_loss',
  });
  const monitoring = {
    sampleFailures: 0,
    truncated: false,
    samples: orderBurstStages.flatMap((phase, i) =>
      [0, 100, 500].map((offset) => ({
        phase: `order-burst-${phase}`,
        elapsedMs: i * 1000 + offset,
        process: { cpuCoreEquivalent: 1, rssBytes: 1000 },
        database: { connections: 7, lock_waiters: 0 },
        api: {
          pool: { total: 5, waiting: 0, policy: { max: 5, maxWaiting: 20 } },
        },
      })),
    ),
  };
  const evidence = {
    checks: Object.fromEntries(
      [
        'uniqueRows',
        'uniqueKeys',
        'expectedDistribution',
        'scoped',
        'receiptIntegrity',
        'numbering',
        'noUnacknowledgedWrites',
        'unpaidOnly',
        'negativeProbeNoWrite',
        'noUnexpectedAccounts',
        'sessionCleanup',
        'orderModes',
        'tokenSafety',
      ].map((name) => [name, true]),
    ),
  };
  const samples = workload.attempts.map((a) => ({
    phase: `order-burst-${a.phase}`,
    outcome: 'committed',
    durationMs: 10,
    acquisitionMs: 2,
    executionMs: 8,
  }));
  for (let i = 0; i < 2; i++)
    samples.push({
      phase: 'order-burst-recovery',
      outcome: 'business_rejection',
      durationMs: 10,
      acquisitionMs: 2,
      executionMs: 8,
    });
  const transactions = summarizeOrderTransactions({
    samples,
    truncated: false,
  });
  return { workload, monitoring, evidence, transactions };
}
function evaluate(f) {
  return evaluateOrderBurst(
    f.workload,
    f.monitoring,
    f.evidence,
    f.transactions,
  );
}
await test('complete bounded order profile passes', () =>
  assert.equal(evaluate(fixture()).pass, true));
for (const [name, mutate] of [
  [
    'missing transaction timings',
    (f) => {
      f.transactions = undefined;
    },
  ],
  [
    'unmatched transaction attempts',
    (f) => {
      f.transactions.attempts++;
    },
  ],
  [
    'unexpected transaction failure',
    (f) => {
      f.transactions.outcomes.unexpected_failure = 1;
    },
  ],
  [
    'slow DB transactions',
    (f) => {
      f.transactions.phases['order-burst-hot-burst'].execution.p95Ms = 5001;
    },
  ],
  [
    'missing token proof',
    (f) => {
      f.evidence.checks.tokenSafety = false;
    },
  ],
  [
    'missing kitchen probes',
    (f) => {
      f.workload.stages[1].probes = f.workload.stages[1].probes.filter(
        (p) => p.kind !== 'kitchen',
      );
    },
  ],
  [
    'slow kitchen query',
    (f) => {
      f.workload.stages[1].probes.find((p) => p.kind === 'kitchen').ms = 1001;
    },
  ],
  [
    'probes after burst ends',
    (f) => {
      for (const p of f.workload.stages[1].probes) p.offsetMs = 1000;
    },
  ],
  [
    'missing database proof',
    (f) => {
      f.evidence.checks = {};
    },
  ],
  [
    'duplicate database writes',
    (f) => {
      f.evidence.checks.uniqueKeys = false;
    },
  ],
  [
    'unacknowledged writes',
    (f) => {
      f.evidence.checks.noUnacknowledgedWrites = false;
    },
  ],
  [
    'slow cashier',
    (f) => {
      f.workload.stages[1].probes[0].ms = 1001;
    },
  ],
  [
    'slow logical retry latency',
    (f) => {
      f.workload.stages[1].p95Ms = 5001;
    },
  ],
  [
    'missing tracking',
    (f) => {
      f.workload.tracking.pop();
    },
  ],
  [
    'pool overload',
    (f) => {
      f.monitoring.samples[0].api.pool.waiting = 21;
    },
  ],
  [
    'missing resource samples',
    (f) => {
      f.monitoring.samples = [];
    },
  ],
  [
    'lost session cleanup',
    (f) => {
      f.workload.sessionsRevoked = 0;
    },
  ],
  [
    'actual network failure',
    (f) => {
      f.workload.attempts.push({
        phase: 'duplicates',
        client: 0,
        status: 'network_error',
      });
    },
  ],
  [
    'too many retries',
    (f) => {
      for (let i = 0; i < 8; i++)
        f.workload.attempts.push({
          phase: 'duplicates',
          client: 0,
          status: '409',
          code: 'ORDER_RETRY_REQUIRED',
        });
    },
  ],
  [
    'non-simultaneous launch',
    (f) => {
      f.workload.stages[1].launchSpreadMs = 101;
    },
  ],
])
  await test(`rejects ${String(name)}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).pass, false);
  });

await test('cashier and kitchen probes validate actual tenant data rather than identity or empty lists', () => {
  const staff = { shopId: 'shop', kitchenIds: ['queued'] },
    expected = { id: 'order', orderNumber: 'ORD-1' };
  const cashier = {
    order: {
      id: 'order',
      shopId: 'shop',
      orderNumber: 'ORD-1',
      status: 'PENDING_CONFIRMATION',
      paymentStatus: 'UNPAID',
      totalPrice: '37.00',
    },
    payment: null,
  };
  const kitchen = {
    orders: [
      {
        id: 'queued',
        shopId: 'shop',
        preparationStatus: 'QUEUED',
        currency: 'PHP',
        totalPrice: '37.00',
        items: [{}, {}],
      },
    ],
  };
  assert.equal(validOrderProbe('cashier', cashier, staff, expected), true);
  assert.equal(
    validOrderProbe('cashier', { user: { id: 'staff' } }, staff, expected),
    false,
  );
  assert.equal(
    validOrderProbe(
      'cashier',
      cashier,
      { ...staff, shopId: 'foreign' },
      expected,
    ),
    false,
  );
  assert.equal(validOrderProbe('kitchen', kitchen, staff), true);
  assert.equal(validOrderProbe('kitchen', { orders: [] }, staff), false);
  assert.equal(
    validOrderProbe('kitchen', kitchen, { ...staff, shopId: 'foreign' }),
    false,
  );
  kitchen.orders[0].id = 'unexpected';
  assert.equal(validOrderProbe('kitchen', kitchen, staff), false);
});

await test('transaction collector keeps concurrent checkout scope, includes commit time and excludes unrelated reads', async () => {
  let time = 0;
  const prisma = {
    $transaction: async (callback) => {
      time += 2;
      const result = await callback({});
      time += 3;
      return result;
    },
  };
  const orders = {
    create: async (value) =>
      prisma.$transaction(async () => {
        await Promise.resolve();
        if (value instanceof Error) throw value;
        return value;
      }),
  };
  const collector = instrumentOrderTransactions(
    orders,
    prisma,
    () => 'order-burst-multi-burst',
    () => ++time,
  );
  const conflict = new Error('synthetic', {
    cause: { kind: 'TransactionWriteConflict' },
  });
  conflict.name = 'DriverAdapterError';
  await Promise.allSettled([
    orders.create('one'),
    orders.create(conflict),
    prisma.$transaction(async () => 'unrelated'),
  ]);
  const result = summarizeOrderTransactions(collector);
  assert.equal(result.attempts, 2);
  assert.equal(result.outcomes.committed, 1);
  assert.equal(result.outcomes.conflict, 1);
  assert.equal(result.unexpectedFailureRate, 0);
  assert.ok(
    result.samples.every(
      (s) =>
        s.executionMs > 0 &&
        s.acquisitionMs > 0 &&
        s.durationMs === s.acquisitionMs + s.executionMs,
    ),
  );
  collector.restore();
  await orders.create('restored');
  assert.equal(collector.samples.length, 2);
});
await test('only serialization conflicts or ambiguous acknowledgements are retryable', () => {
  assert.equal(retryableOrder('409', 'ORDER_RETRY_REQUIRED'), true);
  assert.equal(retryableOrder('network_error'), true);
  for (const [status, code] of [
    ['409', 'ORDER_REQUEST_CONFLICT'],
    ['409', 'PRICE_CHANGED'],
    ['429'],
    ['503'],
    ['400'],
  ])
    assert.equal(retryableOrder(status, code), false);
});
await test('order burst cannot be enabled by inherited environment flags', () => {
  const options = {
    databaseUrl: `postgresql://timeout_fixture:${'a'.repeat(48)}@127.0.0.1:45678/postgres`,
    directory: 'fixture',
    report: 'report',
  };
  assert.equal(
    loadFixtureEnvironment({ LOAD_ORDER_BURST: '1' }, options).LOAD_ORDER_BURST,
    '0',
  );
  assert.equal(
    loadFixtureEnvironment({}, { ...options, orderBurst: true })
      .LOAD_ORDER_BURST,
    '1',
  );
});
