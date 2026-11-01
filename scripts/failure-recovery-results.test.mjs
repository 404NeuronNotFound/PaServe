import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecoveryReport,
  compareRecoveryReports,
  environmentKey,
  profile,
  stageNames,
  regressionFiles,
  recoveryMarkdown,
  comparisonMarkdown,
  validateRecoveryReport,
  recoveryVerdicts,
} from "./failure-recovery-results.mjs";
import { workloadProfile } from "./recovery-workload-results.mjs";

function loadEvidence() {
  const timing = {
    samples: 1000,
    p50Ms: 1,
    p95Ms: 2,
    p99Ms: 3,
    p95Evidence: true,
    p99Evidence: true,
  };
  return {
    pass: true,
    profile: structuredClone(workloadProfile),
    elapsedMs: 40000,
    peakInFlight: 2,
    successRps: 100,
    completedRps: 100,
    latency: { ...timing, samples: 4000 },
    workflows: Object.fromEntries(
      ["read", "write", "readiness", "liveness"].map((name) => [
        name,
        {
          scheduled: 1000,
          sent: 1000,
          completed: 1000,
          success: 1000,
          missed: 0,
          transportErrors: 0,
          unexpected: 0,
          statuses: { [name === "write" ? "201" : "200"]: 1000 },
          latency: { ...timing },
          successRps: 25,
        },
      ]),
    ),
    resources: {
      apiCpuCoreEquivalent: 0.2,
      peakApiCpuCoreEquivalent: 0.4,
      rssStartBytes: 1e8,
      rssPeakBytes: 1.1e8,
      rssEndBytes: 1e8,
      heapPeakBytes: 1e7,
      eventLoopP95Ms: 10,
      apiPoolPeak: 2,
      apiPoolWaitingPeak: 0,
      apiPoolTotalAtEnd: 2,
      apiPoolIdleAtEnd: 2,
      apiPoolWaitingAtEnd: 0,
      databaseClientPeakIncludingMonitor: 3,
      databaseActivePeakExcludingMonitor: 2,
      lockWaiterPeak: 0,
      slowActivePeak: 1,
      slowObservationSamples: 2,
      completedSlowQueriesAt250Ms: 1,
      queryCount: 3001,
      queryFailures: 0,
    },
    monitoring: {
      intervalMs: 100,
      sampleFailures: 0,
      skipped: 0,
      sampleCount: 400,
    },
  };
}

async function cliChecks() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const parent = resolve(root, "artifacts/performance/report-tool-tests");
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, "owned-"));
  const execute = promisify(execFile),
    script = fileURLToPath(
      new URL("./failure-recovery-report.mjs", import.meta.url),
    );
  const baselineInput = join(temporary, "input.json"),
    candidateInput = join(temporary, "candidate.json");
  const saved = result(),
    changed = candidate();
  changed.measurements[0].elapsedMs = 999999;
  await writeFile(baselineInput, JSON.stringify(saved));
  await writeFile(candidateInput, JSON.stringify(changed));
  const invoke = (args) =>
    execute(process.execPath, [script, ...args], {
      cwd: root,
      windowsHide: true,
      timeout: 10000,
    });
  try {
    const base = join(temporary, "baseline"),
      comparison = join(temporary, "comparison");
    await invoke(["baseline", "--input", baselineInput, "--output", base]);
    const original = await readFile(base + ".json", "utf8");
    await assert.rejects(() =>
      invoke(["baseline", "--input", baselineInput, "--output", base]),
    );
    assert.equal(await readFile(base + ".json", "utf8"), original);
    assert.deepEqual(JSON.parse(await readFile(baselineInput, "utf8")), saved);
    await assert.rejects(() =>
      invoke([
        "baseline",
        "--input",
        baselineInput,
        "--output",
        "apps/api/forbidden-report",
      ]),
    );
    await assert.rejects(
      () =>
        invoke([
          "compare",
          "--baseline",
          base + ".json",
          "--candidate",
          candidateInput,
          "--output",
          comparison,
        ]),
      (error) => error.code === 2,
    );
    assert.equal(
      JSON.parse(await readFile(comparison + ".json", "utf8")).status,
      "review-required",
    );
    await assert.rejects(() =>
      invoke([
        "compare",
        "--baseline",
        base + ".json",
        "--candidate",
        baselineInput,
        "--output",
        join(temporary, "self"),
      ]),
    );
  } finally {
    const absolute = resolve(temporary);
    assert.ok(
      absolute.startsWith(parent + sep) &&
        absolute.startsWith(resolve(root, "artifacts") + sep),
    );
    await rm(absolute, { recursive: true, force: true });
  }
}

// Real recorded fixture shape, with deliberately synthetic execution identity/times.
const postgres = JSON.parse(
  await readFile(
    new URL(
      "../artifacts/performance/baselines/2026-11-01-failure-recovery-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).postgres;
const storage = JSON.parse(
  await readFile(
    new URL(
      "../artifacts/performance/baselines/2026-11-01-failure-recovery-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).storage;
function inputs() {
  const runId = "11111111-1111-4111-8111-111111111111";
  const startedAt = "2026-11-01T00:00:00.000Z",
    finishedAt = "2026-11-01T00:02:00.000Z";
  const meta = {
    runId,
    startedAt,
    finishedAt,
    stages: stageNames.map((name) => ({ name, exitCode: 0, elapsedMs: 10 })),
    environment: {
      platform: "win32",
      arch: "x64",
      osRelease: "fixture",
      node: "v24.0.0",
      cpuModel: "test",
      logicalCpus: 8,
      memoryBytes: 1000000,
      packages: {
        "@prisma/client": "7.10.0",
        "@supabase/supabase-js": "2.0.0",
        "@nestjs/core": "12.0.0",
        vitest: "4.0.0",
      },
    },
    source: {
      fingerprint: "a".repeat(64),
      commit: "b".repeat(40),
      workingTree: "modified",
    },
  };
  const db = {
    ...structuredClone(postgres),
    runId,
    startedAt,
    finishedAt,
    profile: structuredClone(profile.database),
    postgresVersion: "17.11",
    workload: loadEvidence(),
  };
  const sdk = { ...structuredClone(storage), runId, startedAt, finishedAt };
  const regression = (name, count) => ({
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: count,
    numTotalTests: count,
    startTime: Date.parse(startedAt),
    testResults: regressionFiles[name].map((file) => ({
      name: `/fixture/${file}`,
      status: "passed",
      assertionResults: [{ status: "passed" }],
    })),
  });
  return {
    meta,
    sources: {
      postgres: db,
      storage: sdk,
      unit: regression("unit", 54),
      http: regression("http", 26),
    },
  };
}
const result = () => {
  const { meta, sources } = inputs();
  return buildRecoveryReport(meta, sources);
};
const candidate = () => {
  const report = result();
  report.runId = "22222222-2222-4222-8222-222222222222";
  report.findings = report.findings.map((row) => ({
    ...row,
    retestRunId: report.runId,
  }));
  return report;
};

test("normalizes complete evidence into a reproducible document without raw payloads", () => {
  const { meta, sources } = inputs();
  sources.postgres.password = "sensitive-payload";
  sources.storage.checks[0].token = "sensitive-payload";
  meta.environment.password = "sensitive-payload";
  meta.source.token = "sensitive-payload";
  const report = buildRecoveryReport(meta, sources);
  assert.equal(report.measurements.length, 27);
  assert.ok(!JSON.stringify(report).includes("sensitive-payload"));
  assert.match(recoveryMarkdown(report), /passed locally/);
  assert.match(recoveryMarkdown(report), /Not a latency percentile/);
});

for (const [name, change] of [
  [
    "stale source",
    ({ sources }) => {
      sources.storage.runId = "other";
    },
  ],
  [
    "source predates run",
    ({ sources }) => {
      sources.postgres.startedAt = "2025-01-01";
    },
  ],
  [
    "source from future",
    ({ sources }) => {
      sources.storage.finishedAt = "2027-01-01";
    },
  ],
  [
    "profile mismatch",
    ({ sources }) => {
      sources.postgres.profile.statementMs = 999;
    },
  ],
  [
    "cleanup incomplete",
    ({ sources }) => {
      sources.postgres.cleanup.postgresStopped = false;
    },
  ],
  [
    "connection leak",
    ({ sources }) => {
      sources.postgres.resources.pool.total = 1;
    },
  ],
  [
    "unreleased lease",
    ({ sources }) => {
      sources.postgres.resources.pool.released = 0;
    },
  ],
  [
    "missing scenario",
    ({ sources }) => {
      sources.storage.checks.pop();
    },
  ],
  [
    "duplicate scenario",
    ({ sources }) => {
      sources.storage.checks[0] = sources.storage.checks[1];
    },
  ],
  [
    "invalid timing",
    ({ sources }) => {
      sources.storage.checks[0].elapsedMs = -1;
    },
  ],
  [
    "skipped test",
    ({ sources }) => {
      sources.unit.numPendingTests = 1;
    },
  ],
  [
    "failed test",
    ({ sources }) => {
      sources.http.success = false;
    },
  ],
  [
    "wrong test files",
    ({ sources }) => {
      sources.unit.testResults[0].name = "/other.spec.ts";
    },
  ],
  [
    "incomplete stages",
    ({ meta }) => {
      meta.stages.pop();
    },
  ],
])
  test(`rejects ${name} instead of certifying a baseline`, () => {
    const input = inputs();
    change(input);
    assert.throws(() => buildRecoveryReport(input.meta, input.sources));
  });

test("comparison detects review thresholds without averaging away a slow scenario", () => {
  const before = result(),
    after = candidate();
  after.measurements[0].elapsedMs =
    before.measurements[0].elapsedMs * 1.5 + 101;
  const comparison = compareRecoveryReports(before, after);
  assert.equal(comparison.status, "review-required");
  assert.equal(comparison.rows.filter((row) => row.reviewRequired).length, 1);
  assert.match(comparisonMarkdown(comparison), /review-required/);
});
test("comparison accepts stable scenarios and implementation changes on the same environment", () => {
  const after = candidate();
  after.source.fingerprint = "c".repeat(64);
  const comparison = compareRecoveryReports(result(), after);
  assert.equal(comparison.status, "no-flagged-regressions");
  assert.equal(comparison.sourceChanged, true);
});
test("different environments never become timing passes", () => {
  const after = candidate();
  after.environment.node = "v25.0.0";
  after.environmentKey = environmentKey(after.environment);
  assert.equal(
    compareRecoveryReports(result(), after).status,
    "incompatible-environment",
  );
});
test("refuses self comparison, legacy data, edited fingerprints and failed candidates", () => {
  assert.throws(() => compareRecoveryReports(result(), result()));
  assert.throws(() => validateRecoveryReport({ postgres, storage }));
  const after = candidate();
  after.environmentKey = "edited";
  assert.throws(() => compareRecoveryReports(result(), after));
  after.environmentKey = environmentKey(after.environment);
  const missingVersions = structuredClone(after);
  delete missingVersions.environment.packages.vitest;
  assert.throws(() => validateRecoveryReport(missingVersions));
  after.pass = false;
  assert.throws(() => compareRecoveryReports(result(), after));
  assert.match(
    recoveryMarkdown({
      status: "failed",
      runId: after.runId,
      failedStage: "postgres-recovery",
    }),
    /No baseline/,
  );
});
test("requires measured runtime resources and real percentile sample counts", () => {
  for (const change of [
    (load) => {
      load.workflows.read.latency.samples = 1;
    },
    (load) => {
      load.resources.apiCpuCoreEquivalent = null;
    },
    (load) => {
      load.resources.slowActivePeak = 0;
    },
    (load) => {
      load.monitoring.sampleCount = 1;
    },
    (load) => {
      load.workflows.write.unexpected = 1;
    },
  ]) {
    const input = inputs();
    change(input.sources.postgres.workload);
    assert.throws(() => buildRecoveryReport(input.meta, input.sources));
  }
});
test("failed and unexecuted scenarios retain a complete explicit verdict matrix", () => {
  const input = inputs();
  input.sources.postgres.checks[0].pass = false;
  input.sources.postgres.pass = false;
  const verdicts = recoveryVerdicts(input.sources, input.meta.runId, []);
  assert.equal(verdicts.length, 31);
  assert.equal(
    verdicts.find((row) => row.id.startsWith("postgres:")).status,
    "FAIL",
  );
  assert.ok(verdicts.some((row) => row.status === "CONDITIONAL"));
  assert.ok(
    recoveryVerdicts({}, input.meta.runId).every(
      (row) => row.status === "CONDITIONAL",
    ),
  );
});
test("compares workload tails and CPU without hiding them in fault-duration averages", () => {
  const after = candidate();
  after.workload.workflows.read.latency.p99Ms = 100;
  after.workload.resources.apiCpuCoreEquivalent = 2;
  const compared = compareRecoveryReports(result(), after);
  assert.equal(compared.status, "review-required");
  assert.ok(
    compared.performanceRows.some(
      (row) => row.metric === "read.p99Ms" && row.reviewRequired,
    ),
  );
  assert.ok(
    compared.performanceRows.some(
      (row) => row.metric === "apiCpuCoreEquivalent" && row.reviewRequired,
    ),
  );
});
test(
  "CLI preserves inputs/baselines, reports review flags, and refuses unsafe output paths",
  cliChecks,
);
