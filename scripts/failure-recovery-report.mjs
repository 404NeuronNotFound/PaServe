import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  readdir,
  access,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { cpus, totalmem, platform, arch, release } from "node:os";
import {
  buildRecoveryReport,
  validateRecoveryReport,
  compareRecoveryReports,
  recoveryMarkdown,
  comparisonMarkdown,
  recoveryVerdicts,
  recoveryFindings,
} from "./failure-recovery-results.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const api = resolve(root, "apps/api"),
  artifacts = resolve(root, "artifacts");
const readJson = async (path) => {
  const bytes = await readFile(path);
  assert.ok(bytes.length <= 2 * 1024 * 1024, "Report too large");
  return JSON.parse(bytes.toString("utf8"));
};
const inside = (parent, path) => {
  const part = relative(parent, path);
  return part && !part.startsWith("..") && !isAbsolute(part);
};
async function outputPath(path) {
  const target = resolve(root, path);
  assert.ok(
    inside(artifacts, target),
    "Output must stay in workspace artifacts",
  );
  const actualArtifacts = await realpath(artifacts);
  assert.ok(
    inside(await realpath(root), actualArtifacts),
    "Artifact directory escapes workspace",
  );
  let ancestor = dirname(target),
    actualAncestor;
  while (!actualAncestor) {
    try {
      actualAncestor = await realpath(ancestor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = dirname(ancestor);
      assert.notEqual(next, ancestor);
      ancestor = next;
    }
  }
  assert.ok(
    actualAncestor === actualArtifacts ||
      inside(actualArtifacts, actualAncestor),
    "Output ancestor escapes artifact directory",
  );
  await mkdir(dirname(target), { recursive: true });
  assert.ok(
    inside(await realpath(artifacts), await realpath(dirname(target))) ||
      (await realpath(artifacts)) === (await realpath(dirname(target))),
    "Output escapes artifact directory",
  );
  return target;
}
async function pair(base, report, markdown) {
  const target = await outputPath(base);
  for (const suffix of [".json", ".md"]) {
    let exists = false;
    try {
      await access(target + suffix);
      exists = true;
    } catch {
      /* absent */
    }
    assert.ok(!exists, "Output already exists; choose a fresh name");
  }
  await writeFile(target + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(target + ".md", markdown, { flag: "wx" });
  return relative(root, target + ".md")
    .split(sep)
    .join("/");
}
async function fingerprint() {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === "generated") continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (/\.(ts|sql|prisma)$/.test(entry.name)) files.push(next);
    }
  }
  for (const path of [
    "apps/api/src",
    "apps/api/prisma",
    "packages/contracts/src",
  ])
    await walk(resolve(root, path));
  files.push(
    ...[
      "pnpm-lock.yaml",
      "apps/api/package.json",
      "package.json",
      "scripts/failure-recovery-results.mjs",
      "scripts/failure-recovery-report.mjs",
      "scripts/recovery-workload-results.mjs",
      "apps/api/test/recovery-workload.mjs",
      "apps/api/test/recovery-workload.client.mjs",
      "apps/api/test/failure-recovery.database-check.mjs",
      "apps/api/test/request-timeouts.local-postgres.mjs",
      "apps/api/test/load-fixture-results.mjs",
      "apps/api/test/supabase-latency.e2e-spec.ts",
      "apps/api/test/request-timeouts.e2e-spec.ts",
    ].map((path) => resolve(root, path)),
  );
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(root, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
async function run() {
  const runId = randomUUID(),
    startedAt = new Date().toISOString();
  const directory = await outputPath(
    `artifacts/performance/failure-recovery/runs/${runId}/placeholder`,
  );
  const runDir = dirname(directory);
  const meta = {
    runId,
    startedAt,
    stages: [],
    environment: {
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      node: process.version,
      cpuModel: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      packages: {},
    },
    source: {
      fingerprint: await fingerprint(),
      commit: "unknown",
      workingTree: "unknown",
    },
  };
  for (const name of [
    "@prisma/client",
    "@supabase/supabase-js",
    "@nestjs/core",
    "vitest",
  ])
    meta.environment.packages[name] = (
      await readJson(resolve(api, "node_modules", name, "package.json"))
    ).version;
  try {
    meta.source.commit = (
      await execute("git", ["rev-parse", "HEAD"], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim();
    meta.source.workingTree = (
      await execute("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim()
      ? "modified"
      : "clean";
  } catch {
    /* A source fingerprint still identifies uncommitted/exported work. */
  }
  const env = {
    ...process.env,
    FAILURE_RECOVERY_RUN_ID: runId,
    FAILURE_RECOVERY_POSTGRES_REPORT: join(runDir, "postgres.json"),
    FAILURE_RECOVERY_STORAGE_REPORT: join(runDir, "storage.json"),
  };
  let current = "preparation",
    report;
  async function stage(name, script, args, cwd = api, timeout = 120000) {
    current = name;
    console.log(`Failure/recovery: ${name}`);
    const began = performance.now();
    let exitCode = 0;
    try {
      await execute(process.execPath, [script, ...args], {
        cwd,
        env,
        windowsHide: true,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      exitCode = 1;
    }
    meta.stages.push({
      name,
      exitCode,
      elapsedMs: Math.round(performance.now() - began),
    });
    assert.equal(exitCode, 0, "Stage failed");
  }
  try {
    await stage(
      "contracts-build",
      resolve(api, "node_modules/typescript/bin/tsc"),
      ["-p", "tsconfig.json"],
      resolve(root, "packages/contracts"),
    );
    await stage(
      "api-build",
      resolve(api, "node_modules/@nestjs/cli/bin/nest.js"),
      ["build"],
    );
    await stage(
      "postgres-recovery",
      resolve(api, "test/request-timeouts.local-postgres.mjs"),
      ["recovery"],
      api,
      300000,
    );
    const vitest = resolve(api, "node_modules/vitest/vitest.mjs");
    await stage("unit-regression", vitest, [
      "run",
      "src/modules/auth/bot-challenge.service.spec.ts",
      "src/modules/orders/new-order-events.service.spec.ts",
      "src/modules/categories/public-menu.repository.spec.ts",
      "--maxWorkers=2",
      "--reporter=json",
      "--outputFile",
      join(runDir, "unit.json"),
    ]);
    await stage("http-regression", vitest, [
      "run",
      "--config",
      "vitest.config.e2e.ts",
      "test/request-timeouts.e2e-spec.ts",
      "test/supabase-latency.e2e-spec.ts",
      "--maxWorkers=2",
      "--reporter=json",
      "--outputFile",
      join(runDir, "http.json"),
    ]);
    current = "evidence-validation";
    assert.equal(
      await fingerprint(),
      meta.source.fingerprint,
      "Sources changed during capture",
    );
    meta.finishedAt = new Date().toISOString();
    report = buildRecoveryReport(meta, {
      postgres: await readJson(join(runDir, "postgres.json")),
      storage: await readJson(join(runDir, "storage.json")),
      unit: await readJson(join(runDir, "unit.json")),
      http: await readJson(join(runDir, "http.json")),
    });
  } catch {
    const optional = async (name) => {
      try {
        return await readJson(join(runDir, name));
      } catch {
        return undefined;
      }
    };
    const sources = {
      postgres: await optional("postgres.json"),
      storage: await optional("storage.json"),
    };
    report = {
      schemaVersion: 2,
      pass: false,
      status: "failed",
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      failedStage: current,
      stages: meta.stages,
      scenarioVerdicts: recoveryVerdicts(sources, runId, meta.stages),
      findings: recoveryFindings(sources.postgres?.workload, runId),
      reason:
        "Execution or evidence validation failed; inspect the stage fixture/results. No baseline promotion permitted.",
    };
    process.exitCode = 1;
  }
  const document = await pair(
    join(runDir, "result"),
    report,
    recoveryMarkdown(report),
  );
  console.log(`${report.status}: ${document}`);
}

const args = process.argv.slice(2),
  mode = args.shift();
try {
  if (mode === "run") {
    assert.equal(args.length, 0, "Run accepts no targets or output overrides");
    await run();
  } else {
    assert.ok(
      ["compare", "baseline"].includes(mode),
      "Use run, compare or baseline",
    );
    assert.ok(args.length % 2 === 0, "Expected named option pairs");
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      assert.ok(
        ["--input", "--baseline", "--candidate", "--output"].includes(
          args[index],
        ) && !options.has(args[index]),
        "Unknown/duplicate option",
      );
      options.set(args[index], resolve(root, args[index + 1]));
    }
    assert.ok(
      options.has("--output"),
      "An explicit fresh output name is required",
    );
    if (mode === "baseline") {
      assert.ok(
        options.size === 2 && options.has("--input"),
        "Use baseline --input result.json --output artifact-name",
      );
      const report = await readJson(options.get("--input"));
      validateRecoveryReport(report);
      console.log(
        await pair(options.get("--output"), report, recoveryMarkdown(report)),
      );
    } else {
      assert.ok(
        options.size === 3 &&
          options.has("--baseline") &&
          options.has("--candidate"),
        "Use compare --baseline result.json --candidate result.json --output artifact-name",
      );
      const report = compareRecoveryReports(
        await readJson(options.get("--baseline")),
        await readJson(options.get("--candidate")),
      );
      console.log(
        await pair(options.get("--output"), report, comparisonMarkdown(report)),
      );
      process.exitCode =
        report.status === "no-flagged-regressions"
          ? 0
          : report.status === "review-required"
            ? 2
            : 3;
    }
  }
} catch {
  console.error(
    "Failure/recovery report operation failed. Check input format, complete evidence, distinct runs and fresh workspace artifact output paths.",
  );
  process.exitCode = 1;
}
