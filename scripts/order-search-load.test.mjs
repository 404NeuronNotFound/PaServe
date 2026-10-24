import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./order-search-load.mjs";

test("capacity metrics count rate limits and failures rather than reporting them as fast successful searches", () => {
  const stats = summarize(
    [
      { ok: true, status: "200", ms: 100 },
      { ok: true, status: "200", ms: 900 },
      { ok: false, status: "429", ms: 1 },
      { ok: false, status: "network_error", ms: 10000 },
    ],
    2,
    2,
  );
  assert.equal(stats.p95Ms, 900);
  assert.equal(stats.errorRate, 0.5);
  assert.equal(stats.requestsPerSecond, 2);
  assert.equal(stats.statusCounts["429"], 1);
  assert.equal(stats.missedScheduledRequests, 2);
  assert.equal(stats.missedRate, 1 / 3);
});
test("empty stages cannot be mistaken for successful low-latency capacity", () => {
  const stats = summarize([], 1);
  assert.equal(stats.errorRate, 1);
  assert.equal(stats.p95Ms, null);
  assert.equal(stats.successes, 0);
});
