import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { connectLoadTarget } from "./load-target.mjs";

export function summarize(samples, elapsedSeconds, missed = 0) {
  const successful = samples.filter((sample) => sample.ok);
  const times = successful.map((sample) => sample.ms).sort((a, b) => a - b);
  const percentile = (p) =>
    times.length
      ? Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)])
      : null;
  return {
    requests: samples.length,
    successes: successful.length,
    failures: samples.length - successful.length,
    errorRate: samples.length
      ? (samples.length - successful.length) / samples.length
      : 1,
    requestsPerSecond: Number((samples.length / elapsedSeconds).toFixed(2)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    missedScheduledRequests: missed,
    missedRate: missed / Math.max(1, missed + samples.length),
    statusCounts: samples.reduce((counts, sample) => {
      counts[sample.status] = (counts[sample.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function numberSetting(env, key, fallback, min, max) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${key} must be between ${min} and ${max}.`);
  return value;
}

export async function runOrderSearchLoad(env = process.env, hooks = {}) {
  const { base, fetch } = await connectLoadTarget(env);
  const levels = (env.LOAD_LEVELS ?? "1,5,10,25,50").split(",").map(Number);
  if (
    !levels.length ||
    levels.length > 6 ||
    levels.some(
      (value, index) =>
        !Number.isInteger(value) ||
        value < 1 ||
        value > 200 ||
        (index && value <= levels[index - 1]),
    )
  )
    throw new Error(
      "LOAD_LEVELS must be up to six increasing integers from 1 to 200.",
    );
  const duration = numberSetting(env, "LOAD_DURATION_SECONDS", 60, 5, 120);
  if (levels.length * duration > 600)
    throw new Error(
      "Keep the total run within ten minutes so access-token expiry does not confound capacity.",
    );
  const searchEvery = numberSetting(
    env,
    "LOAD_SEARCH_EVERY_MS",
    3000,
    400,
    60000,
  );
  const pollEvery = numberSetting(
    env,
    "LOAD_POLL_EVERY_MS",
    15000,
    1000,
    60000,
  );
  const p95Budget = numberSetting(env, "LOAD_P95_MS", 1000, 1, 15000);
  const p99Budget =
    env.LOAD_P99_MS === undefined
      ? null
      : numberSetting(env, "LOAD_P99_MS", 1500, 1, 30000);
  const timeout = numberSetting(env, "LOAD_TIMEOUT_MS", 10000, 100, 30000);
  const views = ["active", "completed", "cancelled"];
  const terms = ["ORD", "Patio", "T1", "000", "A", "missing-order"];
  const demoSlugs = [
    "demo-sinag-at-butil",
    "demo-umaga-sa-dahon",
    "demo-hapag-ng-hiraya",
    "demo-masa-at-mithi",
    "demo-sipa-at-sago",
  ];
  let credentials;
  if (env.LOAD_ACCOUNTS_FILE)
    credentials = JSON.parse(await readFile(env.LOAD_ACCOUNTS_FILE, "utf8"));
  else if (
    env.LOAD_DEMO === "1" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    credentials = demoSlugs.map((slug) => ({
      email: `owner1@${slug}.example.test`,
      password: "PaServe123!",
    }));
  else
    throw new Error(
      "Supply LOAD_ACCOUNTS_FILE with test-owner credentials, or LOAD_DEMO=1 for documented localhost demo data.",
    );
  if (
    !Array.isArray(credentials) ||
    !credentials.length ||
    credentials.length > 10 ||
    credentials.some(
      (account) =>
        typeof account.email !== "string" ||
        typeof account.password !== "string",
    )
  )
    throw new Error(
      "Supply 1–10 test-owner accounts. Larger setup batches need distributed provisioning to respect login rate limits.",
    );
  const accounts = [];
  const startedAt = new Date().toISOString();
  const report = {
    startedAt,
    environment: env.LOAD_ENVIRONMENT ?? "unspecified",
    targetOrigin: base.origin,
    workload: {
      levels,
      stageSeconds: duration,
      searchEveryMs: searchEvery,
      backgroundPollEveryMs: pollEvery,
      views,
      searchesAreDebouncedTerms: true,
      firstPageOnly: true,
      continuePastLatencyFailure: env.LOAD_CONTINUE_ON_LATENCY_FAILURE === "1",
    },
    budgets: {
      p95Ms: p95Budget,
      p99Ms: p99Budget,
      maximumErrorRate: 0.01,
      maximumMissedRate: 0.01,
      minimumSamplesPerStage: 100,
    },
    identities: 0,
    shops: 0,
    stages: [],
    highestPassingVirtualClients: null,
    limitations: [
      "Virtual clients reuse the supplied owner identities; this is not a unique-user capacity claim.",
      "First-page order reads only; no browser rendering, writes, realtime streams, refresh-token load or other dashboards.",
      "Record representative database size, server resources, DB pool metrics and other traffic separately.",
      "This bounded test does not establish saturation capacity or production capacity.",
    ],
  };
  const headers = {
    "Content-Type": "application/json",
    "X-PaServe-Client": "web",
  };
  try {
    for (const credential of credentials) {
      const response = await fetch(new URL("auth/login", base), {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: credential.email,
          password: credential.password,
          keepSignedIn: false,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok)
        throw new Error(
          `Test-account login failed with HTTP ${response.status}. No capacity claim was made.`,
        );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      const result = await response.json();
      // Keep credentials and cookies in memory, including sessions needing cleanup after setup failure.
      const account = {
        token: result.accessToken,
        cookie,
        shopId: "",
        userId: result.user?.id,
      };
      accounts.push(account);
      if (typeof account.token !== "string" || !cookie)
        throw new Error("Test session could not be verified.");
      const me = await fetch(new URL("auth/me", base), {
        headers: { Authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(timeout),
      });
      if (!me.ok)
        throw new Error(
          `Test-account profile check failed with HTTP ${me.status}.`,
        );
      const profile = await me.json();
      const membership = profile.user?.memberships?.find(
        (item) =>
          item.role === "OWNER" &&
          item.shop?.isActive &&
          (!credential.shopId || item.shopId === credential.shopId),
      );
      if (!membership)
        throw new Error(
          "Every test account must own the requested active shop.",
        );
      account.shopId = membership.shopId;
    }
    report.identities = new Set(accounts.map((account) => account.userId)).size;
    report.shops = new Set(accounts.map((account) => account.shopId)).size;
    console.log(
      `Testing ${report.identities} owner identities across ${report.shops} shops. Tokens are never written to the report.`,
    );
    for (const clients of levels) {
      await hooks.onStage?.({ type: "start", virtualClients: clients });
      const samples = [];
      let missed = 0;
      const start = performance.now();
      const end = start + duration * 1000;
      async function loop(client, kind, interval) {
        const account = accounts[client % accounts.length];
        const view = views[client % views.length];
        let sequence = 0;
        let next =
          start + (client / clients) * Math.min(interval, duration * 1000);
        while (next < end) {
          await sleep(Math.max(0, next - performance.now()));
          if (performance.now() >= end) break;
          const requestStart = performance.now();
          const url = new URL(
            `shops/${encodeURIComponent(account.shopId)}/orders/${view}`,
            base,
          );
          if (kind === "search")
            url.searchParams.set(
              "search",
              terms[(sequence + client) % terms.length],
            );
          let status = "network_error";
          let ok = false;
          try {
            const response = await fetch(url, {
              headers: { Authorization: `Bearer ${account.token}` },
              signal: AbortSignal.timeout(timeout),
            });
            status = String(response.status);
            if (response.ok) {
              const data = await response.json();
              ok =
                Array.isArray(data.orders) &&
                data.orders.length <= 25 &&
                data.orders.every((order) => order.shopId === account.shopId);
              if (!ok) status = "invalid_payload";
            } else await response.arrayBuffer();
          } catch {
            /* Record bounded transport failures without logging private response content. */
          }
          samples.push({
            ms: performance.now() - requestStart,
            status,
            ok,
            kind,
            view,
          });
          sequence++;
          next += interval;
          // Do not hide overload by silently slowing the intended user workload.
          if (performance.now() > next) {
            const skipped = Math.min(
              Math.ceil((performance.now() - next) / interval),
              Math.max(0, Math.ceil((end - next) / interval)),
            );
            missed += skipped;
            next += skipped * interval;
          }
        }
      }
      await Promise.all(
        Array.from({ length: clients }, (_, client) =>
          Promise.all([
            loop(client, "search", searchEvery),
            loop(client, "poll", pollEvery),
          ]),
        ),
      );
      // Include the final think-time interval, even when no request lands at the deadline.
      await sleep(Math.max(0, end - performance.now()));
      const elapsed = (performance.now() - start) / 1000;
      const stats = summarize(samples, elapsed, missed);
      const sloPass =
        stats.successes > 0 &&
        stats.p95Ms <= p95Budget &&
        (p99Budget === null || stats.p99Ms <= p99Budget) &&
        stats.errorRate <= 0.01 &&
        stats.missedRate <= 0.01;
      const sampleSufficient =
        stats.requests >= report.budgets.minimumSamplesPerStage;
      const stage = {
        virtualClients: clients,
        startedAt: new Date(
          Date.now() - (performance.now() - start),
        ).toISOString(),
        finishedAt: new Date().toISOString(),
        elapsedSeconds: Number(elapsed.toFixed(2)),
        ...stats,
        sloPass,
        sampleSufficient,
        byTraffic: Object.fromEntries(
          ["search", "poll"].map((kind) => [
            kind,
            summarize(
              samples.filter((sample) => sample.kind === kind),
              elapsed,
            ),
          ]),
        ),
        byView: Object.fromEntries(
          views.map((view) => [
            view,
            summarize(
              samples.filter((sample) => sample.view === view),
              elapsed,
            ),
          ]),
        ),
      };
      report.stages.push(stage);
      await hooks.onStage?.({ type: "complete", virtualClients: clients });
      console.log(
        `${clients} clients: ${stats.requests} requests, ${stats.requestsPerSecond} req/s, p95 ${stats.p95Ms ?? "n/a"} ms, ${(stats.errorRate * 100).toFixed(1)}% errors, ${missed} missed; ${sloPass ? "within" : "outside"} budget${sampleSufficient ? "" : " (small sample)"}.`,
      );
      if (sloPass && sampleSufficient)
        report.highestPassingVirtualClients = clients;
      if (
        !sloPass &&
        !(
          env.LOAD_CONTINUE_ON_LATENCY_FAILURE === "1" &&
          stats.successes > 0 &&
          stats.errorRate <= 0.01 &&
          stats.missedRate <= 0.01
        )
      )
        break;
    }
  } finally {
    const results = await Promise.all(
      accounts.map(async (account) => {
        if (!account.cookie) return false;
        try {
          const response = await fetch(new URL("auth/logout", base), {
            method: "POST",
            headers: { ...headers, Cookie: account.cookie },
            body: "{}",
            signal: AbortSignal.timeout(timeout),
          });
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    report.testSessionsRevoked = results.filter(Boolean).length;
    report.testSessionsCreated = accounts.length;
    report.finishedAt = new Date().toISOString();
    const output = resolve(
      env.LOAD_REPORT ??
        `artifacts/performance/order-search-${startedAt.replace(/[:.]/g, "-")}.json`,
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(`Report saved to ${output}`);
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runOrderSearchLoad()
    .then((report) => {
      if (
        !report.stages.length ||
        report.stages.some((stage) => !stage.sloPass) ||
        report.testSessionsRevoked !== report.testSessionsCreated
      )
        process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
