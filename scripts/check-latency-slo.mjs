import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assessLatencyCoverage,
  capacityLatencyObservations,
  latencySloPolicy,
  assessLatencySlo,
} from "./latency-slo.mjs";
import {
  menuCacheLatencyObservations,
  databasePlanLatencyObservations,
} from "./latency-slo-sources.mjs";

// Read-only assessment of a completed owned fixture. Never starts traffic.
const args = process.argv.slice(2);
assert.ok(
  args.length >= 2 && args.length <= 8 && args.length % 2 === 0,
  "Use --input <capacity report> [--menu-report <report>] [--db-report <report>] [--output <assessment>].",
);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(
    ["--input", "--output", "--menu-report", "--db-report"].includes(args[i]) &&
      !options.has(args[i]),
    "Unknown or duplicate option.",
  );
  options.set(args[i], resolve(args[i + 1]));
}
assert.ok(options.has("--input"), "A complete capacity report is required.");
const input = options.get("--input");
const report = JSON.parse(await readFile(input, "utf8"));
assert.ok(
  report.environment === "disposable-development" &&
    report.status === "complete" &&
    report.pass === true &&
    report.cleanup?.postgresStopped &&
    report.cleanup?.ownedDirectoryRemoved &&
    report.capacity?.checks?.headroom &&
    report.runId === report.capacity.workload.runId,
  "Require a complete passing owned capacity report and verified cleanup.",
);
const observations = capacityLatencyObservations(report.capacity.workload);
let cacheTracking;
if (options.has("--menu-report")) {
  cacheTracking = menuCacheLatencyObservations(
    JSON.parse(await readFile(options.get("--menu-report"), "utf8")),
  );
  Object.assign(observations, cacheTracking.observations);
}
const databaseQueries = options.has("--db-report")
  ? databasePlanLatencyObservations(
      JSON.parse(await readFile(options.get("--db-report"), "utf8")),
    ).map((s) => ({
      operation: s.operation,
      ...assessLatencySlo(s.id, s.observation),
    }))
  : [];
const result = {
  ...assessLatencyCoverage(observations),
  cacheTracking: cacheTracking
    ? {
        runId: cacheTracking.runId,
        proof: cacheTracking.proof,
        scope: cacheTracking.scope,
      }
    : null,
  databaseQueries,
  source: {
    runId: report.runId,
    durationSeconds: report.capacity.workload.stages.find(
      (s) => s.role === "headroom",
    ).seconds,
  },
  policy: latencySloPolicy,
};
if (databaseQueries.some((s) => ["failed", "invalid"].includes(s.status))) {
  result.status = "failed";
  result.pass = false;
}
if (options.has("--output")) {
  const output = options.get("--output");
  assert.ok(
    [...options.entries()]
      .filter(([key]) => key !== "--output")
      .every(([, path]) => path !== output),
    "Never overwrite source evidence.",
  );
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
}
console.log(
  JSON.stringify(
    {
      status: result.status,
      measured: result.flows.filter((s) => s.status !== "not_measured"),
      notMeasured: result.flows
        .filter((s) => s.status === "not_measured")
        .map((s) => s.id),
      cacheTracked: !!result.cacheTracking,
      databaseQueries: result.databaseQueries,
    },
    null,
    2,
  ),
);
process.exitCode =
  result.status === "passed" ? 0 : result.status === "partial" ? 2 : 1;
