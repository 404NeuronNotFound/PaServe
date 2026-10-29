// Real loopback HTTP + controller + PostgreSQL measurements, called only by the
// disposable cache fixture. No artificial database delay or mock repository.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { PublicMenuCache } from '../dist/modules/categories/public-menu-cache.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';

const rounded = (value) => Number(value.toFixed(3));
const latency = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    requests: samples.length,
    meanMs: rounded(samples.reduce((sum, ms) => sum + ms, 0) / samples.length),
    p50Ms: rounded(percentile(0.5)),
    p95Ms: rounded(percentile(0.95)),
    p99Ms: rounded(percentile(0.99)),
  };
};

export async function measureCaching({ prisma, shops, config, controller }) {
  assert.equal(process.env.TIMEOUT_DB_LOCAL_FIXTURE, 'true');
  const enabled = new PublicMenuCache(config()),
    disabled = new PublicMenuCache(
      config({ PUBLIC_MENU_CACHE_ENABLED: false }),
    );
  const controls = {
    enabled: controller(new PublicMenuRepository(prisma, enabled)),
    disabled: controller(new PublicMenuRepository(prisma, disabled)),
  };
  let mode;
  const selects = { enabled: 0, disabled: 0 };
  prisma.$on('query', (event) => {
    if (mode && /^(SELECT|WITH)\b/i.test(event.query.trim())) selects[mode]++;
  });
  const secondPages = new Map();
  for (const shop of shops) {
    const first = await controls.disabled.read(shop.slug, { setHeader() {} });
    assert.equal(first.products.length, 100);
    assert.ok(first.nextProductsCursor);
    secondPages.set(shop.slug, first.nextProductsCursor);
  }
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const [, selected, slug] = url.pathname.split('/');
      assert.ok(Object.hasOwn(controls, selected));
      const query = url.searchParams.has('second')
        ? { productsCursor: secondPages.get(slug), categoriesCursor: 'end' }
        : {};
      const result = await controls[selected].read(slug, res, query);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    })().catch(() => {
      res.statusCode = 500;
      res.end('Benchmark request failed');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const samples = { enabled: [], disabled: [] },
    rounds = [];
  const original = await prisma.product.findFirstOrThrow({
    where: { id: shops[0].product.id, shopId: shops[0].id },
    select: { name: true },
  });
  const request = async (selected, index) => {
    // 80% large shop A / 20% shop B; both have first/second-page traffic.
    const slug = shops[index % 5 === 0 ? 1 : 0].slug;
    const start = performance.now();
    const response = await fetch(
      `${origin}/${selected}/${slug}${index % 7 === 0 ? '?second' : ''}`,
      { signal: AbortSignal.timeout(10000) },
    );
    const body = await response.text();
    const ms = performance.now() - start;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const page = JSON.parse(body);
    assert.equal(page.shop.slug, slug);
    assert.equal(page.products.length, 100);
    return { ms, digest: createHash('sha256').update(body).digest('hex') };
  };
  try {
    // Warm JIT, database buffers, pool, and HTTP connections for both modes.
    // Excluded from measured counters and samples; cache is then made cold.
    for (let i = 0; i < 20; i++) {
      await request(i % 2 ? 'enabled' : 'disabled', i);
    }
    enabled.clear();
    const before = enabled.snapshot();
    for (let round = 0; round < 4; round++) {
      // One real committed menu edit between rounds; neither mode is allowed
      // to serve the old representation. Mutation time is outside read latency.
      await prisma.product.update({
        where: { id: shops[0].product.id, shopId: shops[0].id },
        data: { name: `Benchmark menu edit ${round}` },
      });
      const outcomes = {};
      const order =
        round % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'];
      for (const selected of order) {
        mode = selected;
        const completed = [];
        const started = performance.now();
        try {
          // Four clients, sixty requests per mode/round, identical trace.
          for (let offset = 0; offset < 60; offset += 4) {
            completed.push(
              ...(await Promise.all(
                Array.from({ length: 4 }, (_, i) =>
                  request(selected, offset + i),
                ),
              )),
            );
          }
        } finally {
          mode = undefined;
        }
        outcomes[selected] = completed;
        samples[selected].push(...completed.map((value) => value.ms));
        rounds.push({
          round: round + 1,
          mode: selected,
          ...latency(completed.map((value) => value.ms)),
          elapsedMs: rounded(performance.now() - started),
        });
      }
      assert.deepEqual(
        outcomes.enabled.map((value) => value.digest),
        outcomes.disabled.map((value) => value.digest),
        'Cached and live responses must match after each menu edit',
      );
    }
    const after = enabled.snapshot();
    const counters = Object.fromEntries(
      ['hits', 'misses', 'coalesced', 'bypassed', 'loadErrors'].map((key) => [
        key,
        after[key] - before[key],
      ]),
    );
    const requests = samples.enabled.length;
    assert.equal(requests, 240);
    assert.equal(
      Object.values(counters).reduce((sum, n) => sum + n, 0),
      requests,
    );
    assert.equal(counters.loadErrors, 0);
    assert.equal(counters.bypassed, 0);
    assert.ok(
      counters.hits / requests > 0.85,
      'Repeat-menu hit rate below 85%',
    );
    // Second-page requests mark categories as exhausted and save that SELECT.
    const secondPageRequests = 4 * Math.ceil(60 / 7);
    assert.equal(selects.disabled, requests * 4 - secondPageRequests);
    assert.ok(selects.enabled >= requests * 3 + counters.misses);
    assert.ok(selects.enabled <= requests * 3 + counters.misses * 2);
    assert.ok(selects.enabled < selects.disabled);
    const cached = latency(samples.enabled),
      live = latency(samples.disabled);
    return {
      pass: true,
      workload: {
        shops: 2,
        productsPerShop: 200,
        productsPerPage: 100,
        clients: 4,
        rounds: 4,
        requestsPerMode: requests,
        secondPageRequestsPerMode: secondPageRequests,
        menuEdits: 4,
        order:
          'Alternating enabled/disabled blocks; identical per-round request trace',
        warmup: '20 excluded HTTP requests, then clear enabled cache',
      },
      counters,
      hitRatePercent: rounded((counters.hits / requests) * 100),
      coalescedRatePercent: rounded((counters.coalesced / requests) * 100),
      selects,
      latency: { enabled: cached, disabled: live },
      improvementPercent: Object.fromEntries(
        ['meanMs', 'p50Ms', 'p95Ms', 'p99Ms'].map((key) => [
          key,
          rounded(((live[key] - cached[key]) / live[key]) * 100),
        ]),
      ),
      rounds,
      samplesMs: Object.fromEntries(
        Object.entries(samples).map(([key, values]) => [
          key,
          values.map(rounded),
        ]),
      ),
      scope:
        'Real loopback HTTP, JSON serialization, controller, runtime adapter and PostgreSQL. No injected delay. This fixture HTTP server omits Nest middleware/guards, TLS, CDN and browser rendering. Finite closed-loop workload; not production SLOs or a saturation/scaling test. Latency is reported, not used as a flaky CI timing gate.',
    };
  } finally {
    mode = undefined;
    try {
      await prisma.product.update({
        where: { id: shops[0].product.id, shopId: shops[0].id },
        data: original,
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      enabled.onModuleDestroy();
      disabled.onModuleDestroy();
    }
  }
}
