import assert from "node:assert/strict";
import { workloadProfile } from "../apps/api/test/recovery-workload.client.mjs";
export { workloadProfile };
const finite = (n) => Number.isFinite(n) && n >= 0;
export const workflowNames = ["read", "write", "readiness", "liveness"];

export function assessRecoveryWorkload(report) {
  assert.ok(report, "Missing workload");
  assert.deepStrictEqual(
    report.profile,
    workloadProfile,
    "Unknown workload profile",
  );
  const verdicts = workflowNames.map((name) => {
    const row = report.workflows?.[name];
    const complete =
      row &&
      row.scheduled === 1000 &&
      row.sent === 1000 &&
      row.completed === 1000 &&
      row.success === 1000 &&
      row.missed === 0 &&
      row.transportErrors === 0 &&
      row.unexpected === 0 &&
      Object.values(row.statuses).reduce((n, count) => n + count, 0) === 1000 &&
      row.statuses[name === "write" ? "201" : "200"] === 1000;
    const timing = row?.latency;
    const measured =
      timing &&
      timing.samples === row.success &&
      [timing.p50Ms, timing.p95Ms, timing.p99Ms].every(finite) &&
      timing.p50Ms <= timing.p95Ms &&
      timing.p95Ms <= timing.p99Ms;
    return {
      id: `load:${name}`,
      status:
        !complete || !measured || timing.p95Ms > 1000 || timing.p99Ms > 1500
          ? "FAIL"
          : timing.samples < 1000
            ? "CONDITIONAL"
            : "PASS",
      reason: !complete
        ? "Missing work, unexpected status or transport error"
        : !measured
          ? "Invalid latency samples"
          : "Recorded successful-response percentiles; fixture p95/p99 guards 1000/1500 ms",
    };
  });
  const resource = report.resources,
    monitor = report.monitoring;
  const metrics =
    resource &&
    [
      "apiCpuCoreEquivalent",
      "peakApiCpuCoreEquivalent",
      "rssStartBytes",
      "rssPeakBytes",
      "rssEndBytes",
      "heapPeakBytes",
      "eventLoopP95Ms",
      "apiPoolPeak",
      "apiPoolWaitingPeak",
      "apiPoolTotalAtEnd",
      "apiPoolIdleAtEnd",
      "apiPoolWaitingAtEnd",
      "databaseClientPeakIncludingMonitor",
      "databaseActivePeakExcludingMonitor",
      "lockWaiterPeak",
      "slowActivePeak",
      "slowObservationSamples",
      "completedSlowQueriesAt250Ms",
      "queryCount",
      "queryFailures",
    ].every((key) => finite(resource[key]));
  const resourcePass =
    metrics &&
    resource.rssPeakBytes > 0 &&
    resource.heapPeakBytes > 0 &&
    resource.apiPoolPeak <= 2 &&
    resource.apiPoolTotalAtEnd === resource.apiPoolIdleAtEnd &&
    resource.apiPoolWaitingAtEnd === 0 &&
    resource.slowActivePeak >= 1 &&
    resource.slowObservationSamples >= 1 &&
    resource.completedSlowQueriesAt250Ms >= 1 &&
    resource.queryCount >= 3001 &&
    resource.queryFailures === 0 &&
    monitor?.sampleFailures === 0 &&
    monitor.intervalMs === 100 &&
    finite(monitor.skipped) &&
    (monitor.sampleCount ?? monitor.samples?.length ?? 0) >= 320;
  const aggregatePass =
    finite(report.elapsedMs) &&
    report.elapsedMs >= 40000 &&
    report.successRps >= 90 &&
    report.successRps <= 101 &&
    report.completedRps >= 90 &&
    report.peakInFlight >= 1 &&
    report.peakInFlight <= 8 &&
    report.latency?.samples === 4000 &&
    Math.abs(report.successRps - 4000000 / report.elapsedMs) < 0.001 &&
    [report.latency.p50Ms, report.latency.p95Ms, report.latency.p99Ms].every(
      finite,
    );
  return {
    pass:
      verdicts.every((row) => row.status === "PASS") &&
      Boolean(resourcePass) &&
      Boolean(aggregatePass),
    verdicts,
    resourcePass: Boolean(resourcePass),
    aggregatePass: Boolean(aggregatePass),
  };
}

export function summarizeRecoveryWorkload(report) {
  const assessment = assessRecoveryWorkload(report);
  assert.ok(assessment.pass, "Workload or monitoring did not pass");
  const fields = [
    "scheduled",
    "sent",
    "completed",
    "success",
    "transportErrors",
    "unexpected",
    "missed",
    "successRps",
  ];
  return {
    profile: workloadProfile,
    elapsedMs: report.elapsedMs,
    peakInFlight: report.peakInFlight,
    successRps: report.successRps,
    completedRps: report.completedRps,
    workflows: Object.fromEntries(
      workflowNames.map((name) => {
        const row = report.workflows[name];
        return [
          name,
          {
            ...Object.fromEntries(fields.map((key) => [key, row[key]])),
            statuses: {
              [name === "write" ? "201" : "200"]:
                row.statuses[name === "write" ? "201" : "200"],
            },
            latency: {
              samples: row.latency.samples,
              p50Ms: row.latency.p50Ms,
              p95Ms: row.latency.p95Ms,
              p99Ms: row.latency.p99Ms,
              p95Evidence: row.latency.samples >= 100,
              p99Evidence: row.latency.samples >= 1000,
            },
          },
        ];
      }),
    ),
    latency: { ...report.latency },
    resources: { ...report.resources },
    monitoring: {
      intervalMs: report.monitoring.intervalMs,
      sampleFailures: report.monitoring.sampleFailures,
      skipped: report.monitoring.skipped,
      sampleCount:
        report.monitoring.sampleCount ?? report.monitoring.samples.length,
    },
    resourceScope:
      "API/proxy/collector CPU and memory; separate load-client process; DB CPU not included.",
    verdicts: assessment.verdicts,
  };
}
