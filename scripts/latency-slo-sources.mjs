import assert from "node:assert/strict";

export function menuCacheLatencyObservations(report) {
  assert.ok(
    report.pass === true &&
      report.status === "complete" &&
      report.environment === "disposable-development" &&
      report.cleanup?.postgresStopped &&
      report.cleanup?.ownedDirectoryRemoved &&
      report.menuSpike?.pass === true,
    "Require a complete owned menu-spike report with verified cleanup.",
  );
  const observations = {},
    proof = {};
  for (const [phase, id, cacheState] of [
    ["cold-spike", "api.menu.cold-start", "cold-start-burst"],
    ["warm-spike", "api.menu.warm-cache", "warm-cache-burst"],
  ]) {
    const matches = report.menuSpike.stages.filter((s) => s.phase === phase);
    assert.equal(matches.length, 1, "Require exactly one cache cohort stage.");
    const stage = matches[0],
      cache = stage.cacheDelta;
    assert.ok(
      stage.pass === true &&
        stage.requests > 0 &&
        cache.loadErrors === 0 &&
        cache.bypassed === 0 &&
        [cache.hits, cache.misses, cache.coalesced].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        ),
      "Invalid cache cohort proof.",
    );
    assert.ok(
      phase === "cold-spike"
        ? cache.misses === 1 &&
            cache.hits + cache.coalesced === stage.requests - 1
        : cache.hits === stage.requests &&
            cache.misses === 0 &&
            cache.coalesced === 0,
      "Cache counters do not prove the declared cold/warm cohort.",
    );
    const summary = stage.byReadKind.menu;
    assert.equal(
      summary.requests,
      stage.requests,
      "Cache cohort mixes non-menu requests.",
    );
    observations[id] = {
      context: "normal",
      complete: true,
      boundary: "api-complete-body",
      cacheState,
      durationSeconds: stage.requestWindowSeconds,
      expectedRequests: stage.requests,
      latencySamples: summary.successes,
      summary,
    };
    proof[id] = { sourcePhase: phase, cacheState, counters: { ...cache } };
  }
  return {
    observations,
    proof,
    runId: report.runId,
    scope:
      "Cold-start burst includes one shared miss plus hits/coalescing; warm burst is all hits. Neither means cold PostgreSQL/OS/CDN buffers.",
  };
}

export function databasePlanLatencyObservations(report) {
  assert.ok(
    report.pass === true &&
      report.environment ===
        "disposable local PostgreSQL; not production latency evidence" &&
      Array.isArray(report.after) &&
      report.after.length > 0,
    "Require the successful disposable indexing-plan report.",
  );
  const mapping = {
    "pending orders": "db.order-feed",
    "rejected history": "db.order-feed",
    "pending orders next page": "db.order-feed",
    "active orders": "db.order-feed",
    categories: "db.catalog-read",
    "product management": "db.catalog-read",
    "public menu products": "db.catalog-read",
    "category reorder": "db.catalog-read",
  };
  return report.after.map((row) => {
    assert.ok(
      Object.hasOwn(mapping, row.name) &&
        Number.isFinite(row.executionMs) &&
        row.executionMs >= 0,
      "Unknown or invalid DB plan timing; classify its boundary explicitly.",
    );
    return {
      operation: row.name,
      id: mapping[row.name],
      observation: {
        context: "normal",
        complete: true,
        boundary: "db-statement-execution",
        // One instrumented execution is diagnostic, not a timed tail-latency capture.
        durationSeconds: 0,
        expectedRequests: 1,
        latencySamples: 1,
        summary: {
          requests: 1,
          successes: 1,
          failures: 0,
          missedScheduledRequests: 0,
          p50Ms: row.executionMs,
          p95Ms: row.executionMs,
          p99Ms: row.executionMs,
        },
      },
    };
  });
}
