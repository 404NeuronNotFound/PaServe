import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendSecurity } from "../apps/web/security/policy.ts";
import { frontendOrigins } from "../apps/api/src/common/http/frontend-origins.ts";
import { databasePoolPolicy } from "../apps/api/src/database/database-pool.policy.ts";
import { databaseConnection } from "../apps/api/src/database/database-connection.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const { parse } = createRequire(resolve(root, "apps/api/package.json"))(
  "dotenv",
);
export function releaseReadiness(api, web, apiOrigin) {
  const checks = [];
  const check = (name, work) => {
    try {
      if (work() !== true) throw new Error();
      checks.push({ name, passed: true });
    } catch {
      checks.push({ name, passed: false });
    }
  };
  check("api-production-mode", () => api.NODE_ENV === "production");
  check("vercel-managed-ingress", () => !api.TRUSTED_PROXY_CIDRS?.trim());
  check(
    "frontend-production-origin",
    () => frontendOrigins(web.VITE_PUBLIC_APP_URL, true).length === 1,
  );
  check(
    "api-production-origin",
    () => frontendOrigins(apiOrigin, true).length === 1,
  );
  check("credentialed-origin-allowlist", () =>
    frontendOrigins(api.FRONTEND_ORIGINS, true).includes(
      web.VITE_PUBLIC_APP_URL,
    ),
  );
  check(
    "distinct-jwt-signing-secrets",
    () =>
      [api.JWT_ACCESS_SECRET, api.JWT_REFRESH_SECRET].every(
        (value) => value?.trim().length >= 32,
      ) && api.JWT_ACCESS_SECRET !== api.JWT_REFRESH_SECRET,
  );
  check(
    "shared-security-state",
    () =>
      api.SECURITY_STATE_MODE === "postgres" &&
      api.SECURITY_STATE_SECRET?.trim().length >= 32 &&
      ![api.JWT_ACCESS_SECRET, api.JWT_REFRESH_SECRET].includes(
        api.SECURITY_STATE_SECRET,
      ),
  );
  check(
    "verified-runtime-database-tls",
    () =>
      new URL(api.DATABASE_URL).searchParams.get("sslmode") === "verify-full" &&
      api.NODE_TLS_REJECT_UNAUTHORIZED !== "0" &&
      Boolean(databaseConnection(api)),
  );
  check(
    "verified-migration-database-tls",
    () =>
      new URL(
        api.DIRECT_DATABASE_URL?.trim() || api.DATABASE_URL,
      ).searchParams.get("sslmode") === "verify-full" &&
      Boolean(databaseConnection(api, true)),
  );
  check("explicit-database-pool-budgets", () =>
    Boolean(
      api.DB_POOL_MAX_PROCESSES &&
      api.DB_POOL_CONNECTION_BUDGET &&
      databasePoolPolicy(api),
    ),
  );
  check(
    "supabase-server-settings",
    () =>
      new URL(api.SUPABASE_URL).protocol === "https:" &&
      Boolean(api.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  );
  check(
    "matching-public-supabase-project",
    () =>
      api.SUPABASE_URL === web.VITE_SUPABASE_URL &&
      Boolean(web.VITE_SUPABASE_ANON_KEY?.trim()),
  );
  check(
    "production-turnstile",
    () =>
      api.AUTH_BOT_CHALLENGE_ENABLED !== "false" &&
      Boolean(api.TURNSTILE_SECRET_KEY?.trim()) &&
      !/^[123]x0{10}/u.test(api.TURNSTILE_SECRET_KEY) &&
      Boolean(web.VITE_TURNSTILE_SITE_KEY?.trim()) &&
      !/^[123]x0{10}/u.test(web.VITE_TURNSTILE_SITE_KEY) &&
      api.TURNSTILE_HOSTNAMES?.split(",")
        .map((value) => value.trim().toLowerCase())
        .includes(new URL(web.VITE_PUBLIC_APP_URL).hostname),
  );
  check(
    "frontend-build-security",
    () =>
      web.VITE_API_URL === "/api/v1" &&
      web.CSP_REPORT_ONLY !== "true" &&
      Boolean(frontendSecurity({ ...api, ...web }, false, true)),
  );
  return {
    passed: checks.every((item) => item.passed),
    checks,
    scope:
      "offline configuration only; TLS handshake, backup/restore, migrations and hosted acceptance remain separate checks",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  try {
    const api = parse(
      await readFile(
        resolve(root, arg("--api-env", "apps/api/.env.production")),
        "utf8",
      ),
    );
    const web = parse(
      await readFile(
        resolve(root, arg("--web-env", "apps/web/.env.production")),
        "utf8",
      ),
    );
    const result = releaseReadiness(
      api,
      web,
      arg("--api-origin", process.env.PASERVE_API_ORIGIN),
    );
    if (args.includes("--output")) {
      const output = resolve(root, arg("--output"));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(result, null, 2) + "\n");
    }
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch {
    console.error(
      "Release check could not read production environment files. Provide --api-env, --web-env and --api-origin. No values are printed.",
    );
    process.exitCode = 1;
  }
}
