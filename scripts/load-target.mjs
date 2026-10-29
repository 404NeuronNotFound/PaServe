// Reusable load clients must prove they reached our disposable fixture before
// sending credentials or workload. A localhost URL alone is not proof.
export const LOAD_MARKER_PATH = "/__paserve_load_environment";
const loopback = new Set(["127.0.0.1", "[::1]"]);
export function loadTargetSettings(env) {
  if (!env.LOAD_BASE_URL)
    throw new Error("An explicit isolated LOAD_BASE_URL is required.");
  let base;
  try {
    base = new URL(env.LOAD_BASE_URL);
  } catch {
    throw new Error("Invalid isolated load target URL.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !loopback.has(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.port ||
    !["/api/v1", "/api/v1/"].includes(base.pathname)
  )
    throw new Error(
      "Load targets must be literal loopback API URLs with an explicit port; remote targets are disabled.",
    );
  base.pathname = "/api/v1/";
  if (
    !/^[0-9a-f-]{36}$/.test(env.LOAD_RUN_ID ?? "") ||
    !/^[0-9a-f]{64}$/.test(env.LOAD_ENVIRONMENT_TOKEN ?? "")
  )
    throw new Error("Disposable fixture identity and capability are required.");
  return { base, runId: env.LOAD_RUN_ID, token: env.LOAD_ENVIRONMENT_TOKEN };
}

export async function connectLoadTarget(env, transport = globalThis.fetch) {
  const { base, runId, token } = loadTargetSettings(env);
  const response = await transport(new URL(LOAD_MARKER_PATH, base), {
    headers: { "X-PaServe-Load-Capability": token },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("The target did not attest a disposable load environment.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing load environment attestation.");
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096)
        throw new Error("Oversized load environment attestation.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let marker;
  try {
    marker = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid load environment attestation.");
  }
  const expiry = Date.parse(marker.expiresAt);
  if (
    marker.version !== 1 ||
    marker.runId !== runId ||
    marker.apiBaseUrl !== base.href ||
    marker.environment !== "disposable-development" ||
    marker.fixturesOnly !== true ||
    marker.externalServices !== "blocked" ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now() ||
    expiry > Date.now() + 30 * 60_000
  )
    throw new Error(
      "Load environment identity, isolation or expiry did not match.",
    );
  const fetch = (input, options = {}) => {
    const target = new URL(input, base);
    if (
      Date.now() >= expiry ||
      target.origin !== base.origin ||
      !target.pathname.startsWith(base.pathname) ||
      target.username ||
      target.password ||
      target.hash
    )
      throw new Error(
        "Workload request escaped its attested target or lifetime.",
      );
    return transport(target, {
      ...options,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(10000),
    });
  };
  return { base, runId, fetch };
}
