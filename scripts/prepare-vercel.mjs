import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendSecurity } from "../apps/web/security/policy.ts";

/** Run with Node 24 and the SAME frontend environment used by the release build. */
export function vercelConfiguration(env, backendOrigin) {
  const backend = new URL(backendOrigin);
  const host = backend.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    backend.protocol !== "https:" ||
    backend.username ||
    backend.password ||
    backend.pathname !== "/" ||
    backend.search ||
    backend.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    ["[::1]", "[::]", "0.0.0.0"].includes(host) ||
    /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/u.test(host)
  ) {
    throw new Error(
      "Provide the real HTTPS NestJS API origin without a path or credentials.",
    );
  }
  if (env.VITE_API_URL !== "/api/v1")
    throw new Error("This Vercel topology requires VITE_API_URL=/api/v1.");
  if (env.CSP_REPORT_ONLY === "true")
    throw new Error("Release configuration requires enforced CSP.");
  const security = frontendSecurity(env, false, true);
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: "vite",
    git: { deploymentEnabled: { "*": false, production: true } },
    installCommand: "pnpm install --frozen-lockfile",
    buildCommand: "pnpm --filter web build",
    outputDirectory: "apps/web/dist",
    headers: [
      {
        source: "/(.*)",
        headers: Object.entries(security.deploymentHeaders).map(
          ([key, value]) => ({ key, value }),
        ),
      },
      {
        source: "/api/v1/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ],
    rewrites: [
      {
        source: "/api/v1/:path*",
        destination: `${backend.origin}/api/v1/:path*`,
      },
      {
        source: "/((?!api(?:/|$)|assets(?:/|$)).*)",
        destination: "/index.html",
      },
    ],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const api = args.indexOf("--api-origin");
    const destination = args.indexOf("--output");
    if (api < 0 || !args[api + 1] || destination < 0 || !args[destination + 1])
      throw new Error(
        "Usage: node scripts/prepare-vercel.mjs --api-origin https://your-api-host --output vercel.json",
      );
    const config = vercelConfiguration(process.env, args[api + 1]);
    const output = resolve(args[destination + 1]);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(config, null, 2) + "\n");
    console.log(
      "Vercel configuration prepared. Review it and set the same environment in Vercel before deployment.",
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Vercel configuration could not be prepared.",
    );
    process.exitCode = 1;
  }
}
