import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessLatencySlo,
  assessLatencyCoverage,
  capacityLatencyObservations,
  latencySloPolicy as p,
} from "./latency-slo.mjs";
import {
  menuCacheLatencyObservations,
  databasePlanLatencyObservations,
} from "./latency-slo-sources.mjs";

function observation(id = "api.menu") {
  return {
    ...(p.targets[id].cacheState
      ? { cacheState: p.targets[id].cacheState }
      : {}),
    context: "normal",
    complete: true,
    boundary: p.targets[id].boundary,
    durationSeconds: 180,
    expectedRequests: 2000,
    latencySamples: 2000,
    summary: {
      requests: 2000,
      successes: 2000,
      failures: 0,
      missedScheduledRequests: 0,
      p50Ms: 100,
      p95Ms: 200,
      p99Ms: 400,
    },
  };
}
await test("normal successful complete-body evidence passes explicit p95, p99 and error budgets", () => {
  const result = assessLatencySlo("api.menu", observation());
  assert.equal(result.status, "passed");
  assert.equal(result.errorRate, 0);
  assert.equal(result.budget.p95Ms, 500);
  assert.equal(Object.isFrozen(p.targets["api.menu"]), true);
});
for (const [name, change, status] of [
  [
    "slow p95",
    (o) => {
      o.summary.p95Ms = 501;
      o.summary.p99Ms = 900;
    },
    "failed",
  ],
  [
    "slow p99 despite good p95",
    (o) => {
      o.summary.p99Ms = 1001;
    },
    "failed",
  ],
  [
    "fast failures",
    (o) => {
      o.summary.failures = 200;
      o.summary.successes = o.latencySamples = 1800;
    },
    "failed",
  ],
  [
    "missed jobs",
    (o) => {
      o.summary.requests--;
      o.summary.successes--;
      o.latencySamples--;
      o.summary.missedScheduledRequests = 1;
    },
    "failed",
  ],
  [
    "warmup mixed with traffic",
    (o) => {
      o.context = "overload";
    },
    "invalid",
  ],
  [
    "server-only timer for client target",
    (o) => {
      o.boundary = "server-handler";
    },
    "invalid",
  ],
  [
    "browser duration for API target",
    (o) => {
      o.boundary = "navigation-to-usable-content";
    },
    "invalid",
  ],
  [
    "partial capture",
    (o) => {
      o.complete = false;
    },
    "invalid",
  ],
  [
    "missing jobs hidden by a fast average",
    (o) => {
      o.expectedRequests++;
    },
    "invalid",
  ],
  [
    "counting failed timings as successes",
    (o) => {
      o.latencySamples++;
    },
    "invalid",
  ],
  [
    "inconsistent counters",
    (o) => {
      o.summary.requests--;
    },
    "invalid",
  ],
  [
    "nonfinite timing",
    (o) => {
      o.summary.p99Ms = NaN;
    },
    "invalid",
  ],
  [
    "missing p50",
    (o) => {
      delete o.summary.p50Ms;
    },
    "invalid",
  ],
  [
    "inverted quantiles",
    (o) => {
      o.summary.p95Ms = 500;
      o.summary.p99Ms = 400;
    },
    "invalid",
  ],
  [
    "short capture",
    (o) => {
      o.durationSeconds = 10;
    },
    "insufficient",
  ],
  [
    "small tail sample",
    (o) => {
      o.expectedRequests =
        o.summary.requests =
        o.summary.successes =
        o.latencySamples =
          100;
    },
    "insufficient",
  ],
])
  await test(`${String(name)} cannot produce a passing SLO`, () => {
    const o = observation();
    change(o);
    assert.equal(assessLatencySlo("api.menu", o).status, status);
  });
await test("errors remain failures even when there are too few samples for a tail conclusion", () => {
  const o = observation();
  o.expectedRequests = o.summary.requests = 3;
  o.summary.successes = o.latencySamples = 2;
  o.summary.failures = 1;
  assert.equal(assessLatencySlo("api.menu", o).status, "failed");
});
await test("empty traffic and unmeasured targets never pass", () => {
  assert.equal(assessLatencySlo("api.menu").status, "not_measured");
  const o = observation();
  o.expectedRequests =
    o.summary.requests =
    o.summary.successes =
    o.latencySamples =
      0;
  o.summary.p50Ms = o.summary.p95Ms = o.summary.p99Ms = null;
  assert.equal(assessLatencySlo("api.menu", o).status, "insufficient");
  assert.equal(assessLatencyCoverage({}).status, "partial");
});
await test("one failing workflow cannot be hidden by other passing workflows", () => {
  const a = observation(),
    b = observation("api.dashboard");
  b.summary.p99Ms = 2000;
  const result = assessLatencyCoverage({ "api.menu": a, "api.dashboard": b });
  assert.equal(result.status, "failed");
  assert.equal(result.flows.find((s) => s.id === "api.menu").pass, true);
});
await test("threshold equality passes and 99.9% is an independent success target", () => {
  const o = observation();
  o.summary.p95Ms = 500;
  o.summary.p99Ms = 1000;
  o.summary.failures = 2;
  o.summary.successes = o.latencySamples = 1998;
  assert.equal(assessLatencySlo("api.menu", o).status, "passed");
  o.summary.failures++;
  o.summary.successes--;
  o.latencySamples--;
  assert.equal(assessLatencySlo("api.menu", o).status, "failed");
});
await test("unknown targets and observations are rejected", () => {
  assert.throws(() => assessLatencySlo("__proto__", observation()));
  assert.throws(() => assessLatencyCoverage({ typo: observation() }));
});
await test("complete coverage needs a sufficient passing observation for every defined boundary", () => {
  const observations = Object.fromEntries(
    Object.entries(p.targets).map(([id, budget]) => {
      const o = observation(id);
      o.summary.p50Ms = budget.p95Ms / 2;
      o.summary.p95Ms = budget.p95Ms;
      o.summary.p99Ms = budget.p99Ms;
      return [id, o];
    }),
  );
  assert.equal(assessLatencyCoverage(observations).status, "passed");
  const o = observations["api.menu"];
  o.expectedRequests =
    o.summary.requests =
    o.summary.successes =
    o.latencySamples =
      999;
  assert.equal(assessLatencyCoverage(observations).status, "partial");
});
await test("capacity source uses scheduled per-workflow counts and only the normal headroom stage", () => {
  const summary = observation().summary;
  const source = {
    complete: true,
    sessionsCreated: 0,
    controls: [],
    stages: [
      { role: "level", offeredRps: 256 },
      {
        role: "headroom",
        offeredRps: 40,
        seconds: 200,
        probes: [],
        byKind: Object.fromEntries(
          ["menu", "product", "order-status", "dashboard"].map((kind) => [
            kind,
            { ...summary },
          ]),
        ),
      },
    ],
  };
  const groups = capacityLatencyObservations(source);
  assert.equal(groups["api.menu"].expectedRequests, 2000);
  assert.equal(assessLatencySlo("api.menu", groups["api.menu"]).pass, true);
  source.stages[1].byKind.menu.requests--;
  assert.equal(
    assessLatencySlo(
      "api.menu",
      capacityLatencyObservations(source)["api.menu"],
    ).status,
    "invalid",
  );
});

function menuReport() {
  const summary = { ...observation().summary, requests: 24, successes: 24 };
  return {
    pass: true,
    status: "complete",
    environment: "disposable-development",
    runId: "fixture",
    cleanup: { postgresStopped: true, ownedDirectoryRemoved: true },
    menuSpike: {
      pass: true,
      stages: [
        {
          phase: "cold-spike",
          pass: true,
          requests: 24,
          requestWindowSeconds: 0.2,
          byReadKind: { menu: { ...summary } },
          cacheDelta: {
            misses: 1,
            hits: 22,
            coalesced: 1,
            loadErrors: 0,
            bypassed: 0,
          },
        },
        {
          phase: "warm-spike",
          pass: true,
          requests: 24,
          requestWindowSeconds: 0.15,
          byReadKind: { menu: { ...summary } },
          cacheDelta: {
            misses: 0,
            hits: 24,
            coalesced: 0,
            loadErrors: 0,
            bypassed: 0,
          },
        },
      ],
    },
  };
}
await test("cold and warm cache cohorts remain separate and small samples do not certify tails", () => {
  const cohorts = menuCacheLatencyObservations(menuReport());
  assert.equal(Object.keys(cohorts.observations).length, 2);
  assert.equal(
    assessLatencySlo(
      "api.menu.cold-start",
      cohorts.observations["api.menu.cold-start"],
    ).status,
    "insufficient",
  );
  assert.equal(cohorts.proof["api.menu.warm-cache"].counters.hits, 24);
  const o = observation("api.menu.warm-cache");
  o.cacheState = "mixed";
  assert.equal(assessLatencySlo("api.menu.warm-cache", o).status, "invalid");
});
for (const [name, mutate] of [
  [
    "a miss in warm cohort",
    (r) => {
      r.menuSpike.stages[1].cacheDelta.misses = 1;
    },
  ],
  [
    "unproven cold load",
    (r) => {
      r.menuSpike.stages[0].cacheDelta.misses = 0;
    },
  ],
  [
    "cache bypass",
    (r) => {
      r.menuSpike.stages[0].cacheDelta.bypassed = 1;
    },
  ],
  [
    "incomplete cleanup",
    (r) => {
      r.cleanup.ownedDirectoryRemoved = false;
    },
  ],
  [
    "missing warm stage",
    (r) => {
      r.menuSpike.stages.pop();
    },
  ],
])
  await test(`cache evidence rejects ${String(name)}`, () => {
    const r = menuReport();
    mutate(r);
    assert.throws(() => menuCacheLatencyObservations(r));
  });
await test("common DB operation budgets are distinct from HTTP and repository timings", () => {
  const statement = observation("db.catalog-read");
  statement.summary.p50Ms = 25;
  statement.summary.p95Ms = 50;
  statement.summary.p99Ms = 100;
  assert.equal(assessLatencySlo("db.catalog-read", statement).status, "passed");
  statement.boundary = "api-complete-body";
  assert.equal(
    assessLatencySlo("db.catalog-read", statement).status,
    "invalid",
  );
  const rows = databasePlanLatencyObservations({
    pass: true,
    environment: "disposable local PostgreSQL; not production latency evidence",
    after: [{ name: "public menu products", executionMs: 5 }],
  });
  assert.equal(rows[0].id, "db.catalog-read");
  assert.equal(
    assessLatencySlo(rows[0].id, rows[0].observation).status,
    "insufficient",
  );
  assert.throws(() =>
    databasePlanLatencyObservations({
      pass: true,
      environment: "production",
      after: [],
    }),
  );
});
await test("future-scale goals are planning-only, explicit for every target and never weaken MVP budgets", () => {
  assert.equal(p.goals.futureScale.status, "planning-only");
  assert.equal(p.goals.mvp.maximumErrorRate, p.maximumErrorRate);
  for (const budget of Object.values(p.targets)) {
    assert.ok(
      budget.futureScale.p95Ms > 0 && budget.futureScale.p95Ms <= budget.p95Ms,
    );
    assert.ok(
      budget.futureScale.p99Ms >= budget.futureScale.p95Ms &&
        budget.futureScale.p99Ms <= budget.p99Ms,
    );
    assert.equal(Object.isFrozen(budget.futureScale), true);
  }
  assert.equal(
    p.targets["api.login"].futureScale.p95Ms,
    p.targets["api.login"].p95Ms,
  );
});
