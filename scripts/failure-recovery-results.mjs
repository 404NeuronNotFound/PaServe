import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  workloadProfile,
  workflowNames,
  assessRecoveryWorkload,
  summarizeRecoveryWorkload,
} from "./recovery-workload-results.mjs";

export const databaseCases = [
  "healthy-baseline-and-readiness",
  "statement-timeout-rolls-back-a-partial-write-and-releases-capacity",
  "lock-contention-fails-boundedly-and-recovers-without-restart",
  "database-network-outage-keeps-liveness-up-and-readiness-failed",
  "terminating-only-the-fixture-api-session-rolls-back-and-reconnects",
];
export const storageCases = [
  "delayed-success",
  "stalled-headers",
  "stalled-body",
  "connection-reset",
  "provider-503",
  "invalid-json",
  "dependency-timeout-without-context",
];
export const profile = {
  name: "failure-recovery",
  version: 2,
  workload: workloadProfile,
  database: {
    statementMs: 350,
    lockMs: 150,
    connectionMs: 200,
    poolMax: 2,
    maxWaiting: 1,
  },
  storage: { requestDeadlineMs: 400, dependencyDeadlineMs: 10000 },
  comparison: { relativeLimit: 1.5, additionalMs: 100 },
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const environmentKey = (environment) =>
  digest([
    environment.platform,
    environment.arch,
    environment.osRelease,
    environment.node,
    environment.cpuModel,
    environment.logicalCpus,
    environment.memoryBytes,
    environment.postgresVersion,
  ]);
const finite = (value) => Number.isFinite(value) && value >= 0;
export const stageNames = [
  "contracts-build",
  "api-build",
  "postgres-recovery",
  "unit-regression",
  "http-regression",
];
export const regressionFiles = {
  unit: [
    "bot-challenge.service.spec.ts",
    "new-order-events.service.spec.ts",
    "public-menu.repository.spec.ts",
  ],
  http: ["request-timeouts.e2e-spec.ts", "supabase-latency.e2e-spec.ts"],
};

export function expectedIds() {
  return [
    ...databaseCases.map((name) => `postgres:${name}`),
    ...["logo", "banner", "product"].flatMap((kind) =>
      storageCases.map((name) => `storage:${kind}:${name}`),
    ),
    "storage:logo:client-disconnect",
  ];
}
export function recoveryVerdicts(sources, runId, stages = []) {
  const done = (name) =>
    stages.some((stage) => stage.name === name && stage.exitCode === 0);
  const verdicts = expectedIds().map((id) => {
    const postgres = id.startsWith("postgres:"),
      source = sources[postgres ? "postgres" : "storage"];
    const row =
      source?.runId === runId &&
      source.checks?.find((row) =>
        postgres
          ? id === `postgres:${row.name}`
          : id === `storage:${row.kind}:${row.scenario}`,
      );
    const complete =
      source?.pass === true &&
      done(postgres ? "postgres-recovery" : "http-regression") &&
      (!postgres ||
        (source.cleanup?.postgresStopped === true &&
          source.cleanup?.ownedDirectoryRemoved === true));
    return {
      id,
      status:
        row?.pass === false
          ? "FAIL"
          : row?.pass === true && complete
            ? "PASS"
            : "CONDITIONAL",
      reason:
        row?.pass === false
          ? "Scenario assertion failed"
          : complete && row
            ? "Assertions and fixture completion verified"
            : "Unexecuted, incomplete or unverified evidence",
    };
  });
  let load;
  try {
    if (sources.postgres?.runId === runId)
      load = assessRecoveryWorkload(sources.postgres.workload);
  } catch {
    /* missing/unsupported evidence */
  }
  return [
    ...verdicts,
    ...(load?.verdicts ??
      workflowNames.map((name) => ({
        id: `load:${name}`,
        status: "CONDITIONAL",
        reason: "No complete workload evidence",
      }))),
  ];
}
export function recoveryFindings(workload, runId) {
  return [
    {
      id: "sql-pool-occupancy",
      type: "controlled dependency bottleneck",
      finding:
        "Long SQL and held write locks occupy finite pool capacity. A deliberate 280ms query calibrates detection; this is not a newly discovered production slow query.",
      fix: "Existing SQL/lock/acquisition deadlines and bounded pools retained; rollback and reconnection regression checks repeated.",
      evidence: [
        "postgres:statement-timeout-rolls-back-a-partial-write-and-releases-capacity",
        "postgres:lock-contention-fails-boundedly-and-recovers-without-restart",
      ],
      retestRunId: runId,
      observedSlowSamples: workload?.resources?.slowObservationSamples ?? null,
    },
    {
      id: "missing-performance-evidence",
      type: "reporting gap",
      finding:
        "Single fault observations did not establish latency tails, throughput or runtime utilization.",
      fix: "Added a fixed-rate 4000-request repeat workload, separate client process, 100ms API/DB monitoring and per-workflow percentile evidence.",
      evidence: workflowNames.map((name) => `load:${name}`),
      retestRunId: runId,
    },
    {
      id: "incomplete-verdict-matrix",
      type: "reporting gap",
      finding: "Earlier reports represented only passing scenario rows.",
      fix: "Every expected scenario now has PASS/CONDITIONAL/FAIL; incomplete/unexecuted evidence stays conditional and failed captures cannot become baselines.",
      evidence: ["evidence-validation"],
      retestRunId: runId,
    },
    {
      id: "cleanup-observation-race",
      type: "fixture defect",
      finding:
        "Initiating proxy socket destruction could be observed before close events completed.",
      fix: "Wait for both proxy halves to close and verify zero connections/waiters plus balanced leases. Critical fixture rerun after the fix.",
      evidence: ["postgres-recovery", "fixture-cleanup"],
      retestRunId: runId,
    },
  ];
}
function rows(source, type) {
  assert.ok(Array.isArray(source.checks), "Missing scenario measurements");
  return source.checks.map((row) => {
    assert.ok(
      row.pass === true && finite(row.elapsedMs),
      "Failed or invalid scenario measurement",
    );
    const id =
      type === "postgres"
        ? `postgres:${row.name}`
        : `storage:${row.kind}:${row.scenario}`;
    assert.ok(
      expectedIds().includes(id),
      "Unknown scenario requires a profile update",
    );
    return { id, pass: true, elapsedMs: row.elapsedMs, samples: 1 };
  });
}
export function buildRecoveryReport(meta, sources) {
  const { postgres, storage, unit, http } = sources;
  const workload = summarizeRecoveryWorkload(postgres.workload);
  assert.match(meta.runId, /^[a-f\d-]{36}$/i, "Invalid run identity");
  assert.ok(
    postgres.pass === true &&
      postgres.status === "complete" &&
      storage.pass === true,
    "Source suite did not pass",
  );
  assert.ok(
    postgres.scope ===
      "owned disposable PostgreSQL, real Nest/Prisma and isolated loopback TCP fault proxy" &&
      storage.scope === "real-sdk-local-http-no-live-provider",
    "Unexpected source scope",
  );
  for (const source of [postgres, storage]) {
    assert.equal(source.runId, meta.runId, "Stale or mismatched source run");
    assert.ok(
      Number.isFinite(Date.parse(source.startedAt)) &&
        Number.isFinite(Date.parse(source.finishedAt)) &&
        Date.parse(source.startedAt) >= Date.parse(meta.startedAt) &&
        Date.parse(source.finishedAt) >= Date.parse(source.startedAt) &&
        Date.parse(source.finishedAt) <= Date.parse(meta.finishedAt),
      "Invalid source capture window",
    );
  }
  assert.ok(
    same(postgres.profile, profile.database) &&
      storage.requestDeadlineMs === profile.storage.requestDeadlineMs &&
      storage.dependencyDeadlineMs === profile.storage.dependencyDeadlineMs,
    "Different test profile",
  );
  assert.ok(
    postgres.cleanup?.postgresStopped === true &&
      postgres.cleanup?.ownedDirectoryRemoved === true,
    "Missing fixture cleanup",
  );
  const pool = postgres.resources?.pool;
  assert.ok(
    pool?.total === 0 &&
      pool.waiting === 0 &&
      pool.pendingCheckouts === 0 &&
      Number.isInteger(pool.acquired) &&
      pool.acquired > 0 &&
      pool.acquired === pool.released &&
      postgres.resources.remainingProxySockets === 0,
    "Resources did not return to a released baseline",
  );
  const regressions = {};
  for (const [name, result, minimum] of [
    ["unit", unit, 54],
    ["http", http, 26],
  ]) {
    assert.ok(
      result?.success === true &&
        result.numFailedTests === 0 &&
        result.numPendingTests === 0 &&
        result.numTodoTests === 0 &&
        result.numFailedTestSuites === 0 &&
        result.numPassedTests >= minimum &&
        result.numTotalTests === result.numPassedTests &&
        result.startTime >= Date.parse(meta.startedAt) &&
        result.startTime <= Date.parse(meta.finishedAt),
      "Missing, incomplete or failed regression suite",
    );
    const files = result.testResults?.map((file) =>
      file.name.replaceAll("\\", "/").split("/").at(-1),
    );
    assert.ok(
      files?.length === regressionFiles[name].length &&
        regressionFiles[name].every((file) => files.includes(file)) &&
        result.testResults.every(
          (file) =>
            file.status === "passed" &&
            file.assertionResults?.length > 0 &&
            file.assertionResults.every(
              (assertion) => assertion.status === "passed",
            ),
        ),
      "Wrong or incomplete regression files",
    );
    regressions[name] = {
      tests: result.numTotalTests,
      passed: result.numPassedTests,
      suites: regressionFiles[name],
    };
  }
  assert.ok(
    meta.stages.length === 5 &&
      meta.stages.every((stage) => stage.exitCode === 0),
    "Incomplete execution stages",
  );
  const measurements = [
    ...rows(postgres, "postgres"),
    ...rows(storage, "storage"),
  ].sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(
    measurements.length === 27 &&
      new Set(measurements.map((row) => row.id)).size === 27,
    "Missing or duplicated scenario",
  );
  const environment = Object.fromEntries(
    [
      "platform",
      "arch",
      "osRelease",
      "node",
      "cpuModel",
      "logicalCpus",
      "memoryBytes",
    ].map((key) => [key, meta.environment[key]]),
  );
  environment.postgresVersion = postgres.postgresVersion;
  environment.packages = Object.fromEntries(
    ["@prisma/client", "@supabase/supabase-js", "@nestjs/core", "vitest"].map(
      (key) => [key, meta.environment.packages[key]],
    ),
  );
  const result = {
    schemaVersion: 2,
    profile,
    status: "passed",
    pass: true,
    runId: meta.runId,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    environment,
    environmentKey: environmentKey(environment),
    source: {
      fingerprint: meta.source.fingerprint,
      commit: meta.source.commit,
      workingTree: meta.source.workingTree,
    },
    stages: meta.stages.map(({ name, exitCode, elapsedMs }) => ({
      name,
      exitCode,
      elapsedMs,
    })),
    regressions,
    measurements,
    workload,
    scenarioVerdicts: recoveryVerdicts(sources, meta.runId, meta.stages),
    findings: recoveryFindings(workload, meta.runId),
    resources: {
      connections: 0,
      waiting: 0,
      proxySockets: 0,
      acquired: pool.acquired,
      released: pool.released,
    },
    cleanup: { postgresStopped: true, ownedDirectoryRemoved: true },
    limitations: [
      "Local fixtures only; CAPTCHA/realtime regression uses mocks.",
      "Fault scenarios have one compound observation; repeated workload percentiles are recorded separately and are not production SLO proof.",
      "No hosted disaster recovery, DNS/TLS, full PostgreSQL crash or production RTO/RPO claim.",
    ],
  };
  validateRecoveryReport(result);
  return result;
}

export function validateRecoveryReport(report) {
  assert.ok(
    report?.schemaVersion === 2 && same(report.profile, profile),
    "Unsupported report/profile",
  );
  assert.ok(
    report.status === "passed" && report.pass === true,
    "Only complete passing reports qualify",
  );
  assert.ok(
    assessRecoveryWorkload(report.workload).pass,
    "Missing measured performance evidence",
  );
  const verdictIds = [
    ...expectedIds(),
    ...workflowNames.map((name) => `load:${name}`),
  ];
  assert.ok(
    report.scenarioVerdicts?.length === 31 &&
      new Set(report.scenarioVerdicts.map((row) => row.id)).size === 31 &&
      verdictIds.every((id) =>
        report.scenarioVerdicts.some(
          (row) => row.id === id && row.status === "PASS",
        ),
      ),
    "Incomplete scenario verdicts",
  );
  assert.ok(
    report.findings?.length >= 4 &&
      report.findings.every(
        (row) => row.retestRunId === report.runId && row.finding && row.fix,
      ),
    "Missing findings/retest record",
  );
  assert.match(report.runId, /^[a-f\d-]{36}$/i);
  const env = report.environment;
  assert.ok(
    env &&
      [
        "platform",
        "arch",
        "osRelease",
        "node",
        "cpuModel",
        "postgresVersion",
      ].every((key) => typeof env[key] === "string" && env[key].length > 0) &&
      Number.isInteger(env.logicalCpus) &&
      env.logicalCpus > 0 &&
      finite(env.memoryBytes) &&
      env.memoryBytes > 0,
    "Incomplete environment metadata",
  );
  assert.equal(
    report.environmentKey,
    environmentKey(env),
    "Invalid environment fingerprint",
  );
  assert.ok(
    ["@prisma/client", "@supabase/supabase-js", "@nestjs/core", "vitest"].every(
      (key) =>
        typeof env.packages?.[key] === "string" &&
        /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(env.packages[key]),
    ),
    "Missing installed package versions",
  );
  assert.ok(
    report.source?.fingerprint?.match(/^[a-f\d]{64}$/),
    "Missing source fingerprint",
  );
  assert.ok(
    report.source.commit === "unknown" ||
      /^[a-f\d]{40,64}$/.test(report.source.commit),
    "Invalid commit identity",
  );
  assert.ok(
    ["clean", "modified", "unknown"].includes(report.source.workingTree),
    "Invalid working tree state",
  );
  assert.ok(
    Number.isFinite(Date.parse(report.startedAt)) &&
      Date.parse(report.finishedAt) >= Date.parse(report.startedAt),
    "Invalid report capture window",
  );
  const ids = report.measurements?.map((row) => row.id);
  assert.ok(
    ids?.length === 27 &&
      new Set(ids).size === 27 &&
      expectedIds().every((id) => ids.includes(id)) &&
      report.measurements.every(
        (row) =>
          row.pass === true && row.samples === 1 && finite(row.elapsedMs),
      ),
    "Invalid measurements",
  );
  assert.ok(
    report.cleanup?.postgresStopped === true &&
      report.cleanup?.ownedDirectoryRemoved === true &&
      report.resources?.connections === 0 &&
      report.resources.waiting === 0 &&
      report.resources.proxySockets === 0 &&
      Number.isInteger(report.resources.acquired) &&
      report.resources.acquired > 0 &&
      report.resources.acquired === report.resources.released,
    "Incomplete resource cleanup",
  );
  assert.ok(
    report.stages?.length === 5 &&
      stageNames.every(
        (name, i) =>
          report.stages[i].name === name &&
          report.stages[i].exitCode === 0 &&
          finite(report.stages[i].elapsedMs),
      ),
    "Incomplete execution stages",
  );
  for (const [name, minimum] of [
    ["unit", 54],
    ["http", 26],
  ]) {
    const suite = report.regressions?.[name];
    assert.ok(
      suite &&
        Number.isInteger(suite.passed) &&
        suite.passed >= minimum &&
        suite.tests === suite.passed &&
        same(suite.suites, regressionFiles[name]),
      "Incomplete test evidence",
    );
  }
}

export function compareRecoveryReports(baseline, candidate) {
  validateRecoveryReport(baseline);
  validateRecoveryReport(candidate);
  assert.notEqual(
    baseline.runId,
    candidate.runId,
    "Baseline and candidate must be distinct executions",
  );
  if (baseline.environmentKey !== candidate.environmentKey)
    return {
      schemaVersion: 2,
      status: "incompatible-environment",
      baselineRunId: baseline.runId,
      candidateRunId: candidate.runId,
      reason:
        "Machine/runtime/database environment differs; do not infer a timing regression.",
      rows: [],
    };
  const before = new Map(
    baseline.measurements.map((row) => [row.id, row.elapsedMs]),
  );
  const rows = candidate.measurements.map((row) => {
    const baselineMs = before.get(row.id),
      limitMs =
        baselineMs * profile.comparison.relativeLimit +
        profile.comparison.additionalMs;
    return {
      id: row.id,
      baselineMs,
      candidateMs: row.elapsedMs,
      deltaMs: row.elapsedMs - baselineMs,
      limitMs,
      reviewRequired: row.elapsedMs > limitMs,
    };
  });
  const performanceRows = workflowNames.flatMap((name) => {
    const before = baseline.workload.workflows[name],
      after = candidate.workload.workflows[name];
    return [
      ...["p50Ms", "p95Ms", "p99Ms"].map((metric) => ({
        metric: `${name}.${metric}`,
        unit: "ms",
        baseline: before.latency[metric],
        candidate: after.latency[metric],
        reviewRequired:
          after.latency[metric] > before.latency[metric] * 1.5 + 20,
      })),
      {
        metric: `${name}.successRps`,
        unit: "requests/sec",
        baseline: before.successRps,
        candidate: after.successRps,
        reviewRequired: after.successRps < before.successRps * 0.9,
      },
    ];
  });
  for (const [metric, ratio, slack] of [
    ["apiCpuCoreEquivalent", 1.5, 0.25],
    ["rssPeakBytes", 1, 64 * 1024 * 1024],
    ["apiPoolWaitingPeak", 1, 1],
  ]) {
    const before = baseline.workload.resources[metric],
      after = candidate.workload.resources[metric];
    performanceRows.push({
      metric,
      unit: metric.endsWith("Bytes")
        ? "bytes"
        : metric.endsWith("Peak")
          ? "connections"
          : "cores",
      baseline: before,
      candidate: after,
      reviewRequired: after > before * ratio + slack,
    });
  }
  return {
    schemaVersion: 2,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    status: [...rows, ...performanceRows].some((row) => row.reviewRequired)
      ? "review-required"
      : "no-flagged-regressions",
    sourceChanged: baseline.source.fingerprint !== candidate.source.fingerprint,
    rows,
    performanceRows,
  };
}
const cell = (value) => String(value ?? "unknown").replace(/[|\r\n`]/g, " ");
const number = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(3)) : "unmeasured";
function verdictMarkdown(report) {
  return `## Scenario verdicts\n\n| Scenario | Verdict | Evidence |\n| --- | --- | --- |\n${(report.scenarioVerdicts ?? []).map((row) => `| ${cell(row.id)} | ${cell(row.status)} | ${cell(row.reason)} |`).join("\n")}\n\n`;
}
function findingsMarkdown(report) {
  return `## Bottlenecks, gaps and fixes\n\n${(report.findings ?? []).map((row) => `- **${cell(row.id)} (${cell(row.type)})**: ${cell(row.finding)} Fix/mitigation: ${cell(row.fix)} Retest: ${cell(row.retestRunId)}; evidence: ${row.evidence.map(cell).join(", ")}.`).join("\n")}\n\n`;
}
function workloadMarkdown(report) {
  const load = report.workload;
  if (!load) return "";
  return `## Repeated workload and runtime metrics\n\nOffered ${load.profile.arrivalRps} requests/sec for ${load.profile.durationMs / 1000} seconds; ${load.profile.requests} scheduled requests. Max in flight ${load.profile.maxInFlight}, observed peak ${load.peakInFlight}, ${load.profile.sourceAddresses} loopback sources. Mix: 25% each read, write, readiness and liveness. One synthetic table/row; zero real tenants.\n\nSuccessful throughput: ${number(load.successRps)} requests/sec; completed throughput: ${number(load.completedRps)} requests/sec. Percentiles below are successful HTTP responses, not compound fault-scenario durations.\n\n| Workflow | Scheduled | Success | Unexpected/transport errors | Missed | RPS | p50 ms | p95 ms | p99 ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${workflowNames
    .map((name) => {
      const row = load.workflows[name];
      return `| ${name} | ${row.scheduled} | ${row.success} | ${row.unexpected + row.transportErrors} | ${row.missed} | ${number(row.successRps)} | ${number(row.latency.p50Ms)} | ${number(row.latency.p95Ms)} | ${number(row.latency.p99Ms)} |`;
    })
    .join(
      "\n",
    )}\n\n${cell(load.resourceScope)}\n\n| Runtime metric | Value |\n| --- | ---: |\n${Object.entries(
    load.resources,
  )
    .map(([key, value]) => `| ${cell(key)} | ${number(value)} |`)
    .join(
      "\n",
    )}\n\nMonitoring: ${load.monitoring.sampleCount} samples at ${load.monitoring.intervalMs} ms; ${load.monitoring.sampleFailures} failures and ${load.monitoring.skipped} skipped ticks. Slow-active counts use a 100ms threshold; completed slow-query counts use the adapter's 250ms threshold. The deliberate 280ms calibration query proves detection and is not a production-query finding. Samples are retained in the raw PostgreSQL report.\n\n`;
}
export function recoveryMarkdown(report) {
  if (report.status !== "passed")
    return (
      `# Failure and recovery result\n\nStatus: **failed / incomplete**\n\nRun: ${cell(report.runId)}\n\nFailed stage: ${cell(report.failedStage)}\n\nNo baseline may be promoted from this run.\n\n` +
      verdictMarkdown(report) +
      findingsMarkdown(report)
    );
  return (
    `# Failure and recovery result\n\nStatus: **passed locally**\n\nRun: ${cell(report.runId)}\n\nStarted: ${cell(report.startedAt)}\n\nFinished: ${cell(report.finishedAt)}\n\n` +
    `Profile: ${profile.name} v${profile.version}\n\nSource fingerprint: ${report.source.fingerprint}\n\nCommit: ${cell(report.source.commit)}; working tree: ${cell(report.source.workingTree)}\n\n` +
    `## Environment\n\n| Field | Value |\n| --- | --- |\n${Object.entries(
      report.environment,
    )
      .map(
        ([key, value]) =>
          `| ${cell(key)} | ${cell(typeof value === "object" ? JSON.stringify(value) : value)} |`,
      )
      .join("\n")}\n\n` +
    `## Scenario measurements\n\nOne observation per scenario; includes recovery/assertion work. Not a latency percentile.\n\n| Scenario | Result | Elapsed ms |\n| --- | --- | ---: |\n${report.measurements.map((row) => `| ${cell(row.id)} | Pass | ${row.elapsedMs} |`).join("\n")}\n\n` +
    `## Profile and reproduction\n\nRun from the repository root: \`pnpm test:failure-recovery\`. The fixture uses one synthetic PostgreSQL table/row and three storage upload classes, not a production tenant dataset.\n\nDatabase: statement ${report.profile.database.statementMs} ms; lock ${report.profile.database.lockMs} ms; connection ${report.profile.database.connectionMs} ms; pool ${report.profile.database.poolMax}; max waiting ${report.profile.database.maxWaiting}. Storage: API deadline ${report.profile.storage.requestDeadlineMs} ms; dependency deadline ${report.profile.storage.dependencyDeadlineMs} ms.\n\n| Stage | Exit | Elapsed ms |\n| --- | ---: | ---: |\n${report.stages.map((stage) => `| ${cell(stage.name)} | ${stage.exitCode} | ${stage.elapsedMs} |`).join("\n")}\n\n` +
    `Regression tests: ${report.regressions.unit.passed} unit, ${report.regressions.http.passed} HTTP.\n\nFinal resources: zero connections/waiters/proxy sockets; ${report.resources.acquired} acquisitions and ${report.resources.released} releases. Fixture PostgreSQL stopped and owned directory removed.\n\n` +
    workloadMarkdown(report) +
    verdictMarkdown(report) +
    findingsMarkdown(report) +
    `## Comparison policy\n\nSame environment/profile required. Flag compound fault durations above baseline × 1.5 + 100 ms for review; loaded percentile bounds use × 1.5 + 20 ms. Workload throughput below 90% of baseline, CPU above × 1.5 + 0.25 cores, RSS above baseline + 64 MiB and pool waiting peak above baseline + 1 require review. Repeated samples support workload percentiles; single fault observations remain diagnostic. Baselines are never automatically replaced.\n\n## Limits\n\n${report.limitations.map((line) => `- ${line}`).join("\n")}\n`
  );
}
export function comparisonMarkdown(report) {
  return (
    `# Failure and recovery comparison\n\nStatus: **${cell(report.status)}**\n\nBaseline: ${cell(report.baselineRunId)}\n\nCandidate: ${cell(report.candidateRunId)}\n\n${cell(report.reason ?? "Timing flags require review, not an automatic conclusion of a regression.")}\n\n` +
    `| Scenario | Baseline ms | Candidate ms | Change ms | Review |\n| --- | ---: | ---: | ---: | --- |\n${report.rows.map((row) => `| ${cell(row.id)} | ${row.baselineMs} | ${row.candidateMs} | ${row.deltaMs} | ${row.reviewRequired ? "Yes" : "No"} |`).join("\n")}\n\n` +
    `| Workload metric | Unit | Baseline | Candidate | Review |\n| --- | --- | ---: | ---: | --- |\n${(report.performanceRows ?? []).map((row) => `| ${cell(row.metric)} | ${row.unit} | ${number(row.baseline)} | ${number(row.candidate)} | ${row.reviewRequired ? "Yes" : "No"} |`).join("\n")}\n`
  );
}
