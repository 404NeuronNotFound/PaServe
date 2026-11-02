import test from "node:test";
import assert from "node:assert/strict";
import { releaseReadiness } from "./release-readiness.mjs";

const api = {
  NODE_ENV: "production",
  FRONTEND_ORIGINS: "https://app.example.test",
  JWT_ACCESS_SECRET: "fixture-access-value-at-least-32-characters",
  JWT_REFRESH_SECRET: "fixture-refresh-value-at-least-32-characters",
  SECURITY_STATE_MODE: "postgres",
  SECURITY_STATE_SECRET: "fixture-state-value-at-least-32-characters",
  DATABASE_URL: "postgresql://fixture@pool.example.test/db?sslmode=verify-full",
  DB_POOL_MAX: "2",
  DB_POOL_MAX_PROCESSES: "3",
  DB_POOL_CONNECTION_BUDGET: "6",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-server-only",
  TURNSTILE_SECRET_KEY: "fixture-provider-secret",
  TURNSTILE_HOSTNAMES: "app.example.test",
};
const web = {
  VITE_API_URL: "/api/v1",
  VITE_PUBLIC_APP_URL: "https://app.example.test",
  VITE_SUPABASE_URL: api.SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: "fixture-public-key",
  VITE_TURNSTILE_SITE_KEY: "fixture-public-site-key",
};
const assess = (a = api, w = web) =>
  releaseReadiness(a, w, "https://api.example.test");

test("accepts complete offline configuration without claiming live verification", () => {
  assert.equal(assess().passed, true);
  assert.match(assess().scope, /offline/);
});
test("reports missing, local and insecure settings without printing values", () => {
  const result = assess({
    ...api,
    DATABASE_URL: "postgresql://fixture@localhost/db",
    JWT_ACCESS_SECRET: "private-fixture",
    SECURITY_STATE_MODE: "local",
    TURNSTILE_HOSTNAMES: undefined,
  });
  assert.equal(result.passed, false);
  assert.equal(
    result.checks.find((item) => item.name === "production-turnstile").passed,
    false,
  );
  assert.doesNotMatch(JSON.stringify(result), /private-fixture|postgresql:/);
});
test("requires matching Supabase projects, public keys, origins and pool budgets", () => {
  assert.equal(
    assess(api, { ...web, VITE_SUPABASE_URL: "https://other.supabase.co" })
      .passed,
    false,
  );
  assert.equal(
    assess({ ...api, DB_POOL_CONNECTION_BUDGET: "5" }).passed,
    false,
  );
  assert.equal(assess(api, { ...web, VITE_PUBLIC_APP_URL: "" }).passed, false);
  assert.equal(
    assess({ ...api, TRUSTED_PROXY_CIDRS: "127.0.0.1" }).passed,
    false,
  );
});
test("rejects credential leakage, shared secrets reused from JWT signing and disabled challenges", () => {
  assert.equal(
    assess(api, { ...web, VITE_SUPABASE_ANON_KEY: api.JWT_ACCESS_SECRET })
      .passed,
    false,
  );
  assert.equal(
    assess(api, { ...web, VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" })
      .passed,
    false,
  );
  assert.equal(
    assess(api, { ...web, VITE_PRIVATE_KEY: "fixture-sensitive-value" }).passed,
    false,
  );
  assert.equal(
    assess({ ...api, SECURITY_STATE_SECRET: api.JWT_ACCESS_SECRET }).passed,
    false,
  );
  assert.equal(
    assess({ ...api, AUTH_BOT_CHALLENGE_ENABLED: "false" }).passed,
    false,
  );
});
