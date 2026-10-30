const target = (
  boundary,
  p95Ms,
  p99Ms,
  futureP95Ms = p95Ms,
  futureP99Ms = p99Ms,
  cacheState,
) =>
  Object.freeze({
    boundary,
    p95Ms,
    p99Ms,
    ...(cacheState ? { cacheState } : {}),
    futureScale: Object.freeze({ p95Ms: futureP95Ms, p99Ms: futureP99Ms }),
  });

// Initial engineering targets. A passing local observation is not a deployed SLO claim.
export const latencySloPolicy = Object.freeze({
  version: 2,
  goals: Object.freeze({
    mvp: Object.freeze({
      status: "active-targets",
      maximumErrorRate: 0.001,
      workload:
        "Validate on the selected deployment; current local read reference is 89 reads/sec, one API, three shops and a five-connection pool.",
    }),
    futureScale: Object.freeze({
      status: "planning-only",
      maximumErrorRate: 0.001,
      workload:
        "Target at least 178 aggregate mixed reads/sec, at least 20 representative tenants with 100,000 orders in the largest, and multiple API instances within a shared DB budget. Not measured or promised capacity.",
    }),
  }),
  reportingWindowDays: 28,
  operationalWindowSeconds: 300,
  minimumObservationSeconds: 60,
  minimumP95Samples: 100,
  minimumP99Samples: 1000,
  maximumErrorRate: 0.001,
  targets: Object.freeze({
    "api.menu": target("api-complete-body", 500, 1000, 250, 500),
    "api.menu.cold-start": target(
      "api-complete-body",
      500,
      1000,
      350,
      750,
      "cold-start-burst",
    ),
    "api.menu.warm-cache": target(
      "api-complete-body",
      500,
      1000,
      200,
      400,
      "warm-cache-burst",
    ),
    "api.product": target("api-complete-body", 500, 1000, 250, 500),
    "api.order-status": target("api-complete-body", 500, 1000, 250, 500),
    "api.login": target("api-complete-body", 1000, 1500),
    "api.order-create": target("logical-order-result", 2000, 4000, 1500, 3000),
    "api.cashier": target("api-complete-body", 500, 1000, 250, 500),
    "api.kitchen": target("api-complete-body", 500, 1000, 250, 500),
    "api.dashboard": target("api-complete-body", 1000, 1500, 500, 1000),
    "api.health": target("api-complete-body", 100, 250),
    "realtime.order-status": target(
      "commit-to-authorized-client",
      1000,
      2000,
      500,
      1000,
    ),
    "browser.menu-ready": target(
      "navigation-to-usable-content",
      2000,
      3500,
      1500,
      2500,
    ),
    "browser.workspace-ready": target(
      "navigation-to-usable-content",
      2000,
      3500,
      1500,
      2500,
    ),
    "browser.checkout-complete": target(
      "submit-to-visible-confirmation",
      3000,
      5000,
      2500,
      4000,
    ),
    "browser.pending-feedback": target(
      "action-to-pending-feedback",
      150,
      300,
      100,
      200,
    ),
    "db.tenant-lookup": target("db-statement-execution", 50, 100, 25, 50),
    "db.catalog-read": target("db-statement-execution", 100, 200, 50, 100),
    "db.order-feed": target("db-statement-execution", 100, 250, 50, 150),
    "db.order-status": target("db-statement-execution", 50, 100, 25, 50),
    "db.daily-sales": target("db-statement-execution", 250, 500, 150, 300),
    "db.order-write": target("db-transaction-client", 500, 1000, 350, 750),
    "db.repository-read": target("db-repository-operation", 250, 500, 150, 300),
  }),
});

export function assessLatencySlo(id, observation) {
  const policy = latencySloPolicy;
  if (!Object.hasOwn(policy.targets, id))
    throw new Error("Unknown latency SLO target.");
  const budget = policy.targets[id];
  if (!observation)
    return {
      id,
      budget,
      status: "not_measured",
      pass: false,
      reasons: ["no-observation"],
    };
  const s = observation.summary;
  const count = (v) => Number.isSafeInteger(v) && v >= 0;
  const valid =
    observation.context === "normal" &&
    observation.complete === true &&
    observation.boundary === budget.boundary &&
    (!budget.cacheState || observation.cacheState === budget.cacheState) &&
    Number.isFinite(observation.durationSeconds) &&
    observation.durationSeconds >= 0 &&
    !!s &&
    [
      s.requests,
      s.successes,
      s.failures,
      s.missedScheduledRequests,
      observation.expectedRequests,
      observation.latencySamples,
    ].every(count) &&
    s.requests === s.successes + s.failures &&
    s.requests + s.missedScheduledRequests === observation.expectedRequests &&
    observation.latencySamples === s.successes &&
    (s.successes === 0
      ? [s.p50Ms, s.p95Ms, s.p99Ms].every((v) => v === null)
      : [s.p50Ms, s.p95Ms, s.p99Ms].every(
          (v) => Number.isFinite(v) && v >= 0,
        ) &&
        s.p50Ms <= s.p95Ms &&
        s.p95Ms <= s.p99Ms);
  if (!valid)
    return {
      id,
      budget,
      status: "invalid",
      pass: false,
      reasons: ["invalid-counts-timing-boundary-or-context"],
    };
  const attempts = observation.expectedRequests;
  const errorRate = attempts
    ? (s.failures + s.missedScheduledRequests) / attempts
    : null;
  const reasons = [];
  if (errorRate !== null && errorRate > policy.maximumErrorRate)
    reasons.push("error-budget-exceeded");
  if (s.missedScheduledRequests > 0) reasons.push("missed-dispatches");
  if (s.successes > 0 && s.p95Ms > budget.p95Ms) reasons.push("p95-exceeded");
  if (s.successes > 0 && s.p99Ms > budget.p99Ms) reasons.push("p99-exceeded");
  const breached = reasons.length > 0;
  if (observation.durationSeconds < policy.minimumObservationSeconds)
    reasons.push("short-observation");
  if (observation.latencySamples < policy.minimumP95Samples)
    reasons.push("insufficient-p95-samples");
  if (observation.latencySamples < policy.minimumP99Samples)
    reasons.push("insufficient-p99-samples");
  const status = breached
    ? "failed"
    : reasons.length
      ? "insufficient"
      : "passed";
  return {
    id,
    budget,
    ...(budget.cacheState ? { cacheState: observation.cacheState } : {}),
    status,
    pass: status === "passed",
    reasons,
    errorRate,
    expectedRequests: attempts,
    successfulLatencySamples: observation.latencySamples,
    durationSeconds: observation.durationSeconds,
    p50Ms: s.p50Ms,
    p95Ms: s.p95Ms,
    p99Ms: s.p99Ms,
  };
}

export function assessLatencyCoverage(observations) {
  if (
    Object.keys(observations).some(
      (id) => !Object.hasOwn(latencySloPolicy.targets, id),
    )
  )
    throw new Error("Unknown latency SLO observation.");
  const flows = Object.keys(latencySloPolicy.targets).map((id) =>
    assessLatencySlo(id, observations[id]),
  );
  const status = flows.some((s) => ["failed", "invalid"].includes(s.status))
    ? "failed"
    : flows.every((s) => s.pass)
      ? "passed"
      : "partial";
  return {
    policyVersion: latencySloPolicy.version,
    goal: "mvp",
    status,
    pass: status === "passed",
    flows,
    scope:
      "Observed normal-load samples only; production attainment requires the defined reporting window and telemetry.",
  };
}

export function capacityLatencyObservations(workload) {
  const stage = workload.stages.find((s) => s.role === "headroom");
  if (!stage) return {};
  const observations = {};
  for (const [index, kind] of [
    "menu",
    "product",
    "order-status",
    "dashboard",
  ].entries()) {
    const summary = stage.byKind[kind];
    observations[`api.${kind}`] = {
      context: "normal",
      complete: workload.complete === true,
      boundary: "api-complete-body",
      durationSeconds: stage.seconds,
      expectedRequests: Math.floor(
        (stage.offeredRps * stage.seconds + 3 - index) / 4,
      ),
      latencySamples: summary.successes,
      summary,
    };
  }
  const summarize = (samples, missed) => {
    const times = samples
      .filter((s) => s.ok)
      .map((s) => s.ms)
      .sort((a, b) => a - b);
    const quantile = (p) =>
      times.length ? times[Math.ceil(times.length * p) - 1] : null;
    return {
      requests: samples.length,
      successes: times.length,
      failures: samples.length - times.length,
      missedScheduledRequests: missed,
      p50Ms: quantile(0.5),
      p95Ms: quantile(0.95),
      p99Ms: quantile(0.99),
    };
  };
  for (const kind of ["cashier", "kitchen", "health"]) {
    const samples = stage.probes.filter((s) => s.kind === kind);
    const summary = summarize(samples, stage.seconds - samples.length);
    observations[`api.${kind}`] = {
      context: "normal",
      complete: workload.complete === true,
      boundary: "api-complete-body",
      durationSeconds: stage.seconds,
      expectedRequests: stage.seconds,
      latencySamples: summary.successes,
      summary,
    };
  }
  const logins = workload.controls.filter((s) => s.kind === "login");
  const summary = summarize(logins, workload.sessionsCreated - logins.length);
  observations["api.login"] = {
    context: "normal",
    complete: workload.complete === true,
    boundary: "api-complete-body",
    durationSeconds: logins.reduce((sum, s) => sum + s.ms, 0) / 1000,
    expectedRequests: workload.sessionsCreated,
    latencySamples: summary.successes,
    summary,
  };
  return observations;
}
