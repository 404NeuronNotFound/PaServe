import test from "node:test";
import assert from "node:assert/strict";
import { vercelConfiguration } from "./prepare-vercel.mjs";
const env = {
  VITE_API_URL: "/api/v1",
  VITE_SUPABASE_URL: "https://project.supabase.co",
  VITE_GOOGLE_CLIENT_ID: "public-client",
};
test("routes API before the SPA and emits actual Vercel headers including OAuth popup policy", () => {
  const result = vercelConfiguration(env, "https://api.example.test");
  assert.equal(result.outputDirectory, "apps/web/dist");
  assert.deepEqual(result.git.deploymentEnabled, { "*": false, production: true });
  assert.equal(
    result.rewrites[0].destination,
    "https://api.example.test/api/v1/:path*",
  );
  assert.equal(result.rewrites[1].destination, "/index.html");
  const headers = Object.fromEntries(
    result.headers[0].headers.map((item) => [item.key, item.value]),
  );
  assert.ok(
    headers["Content-Security-Policy"].includes("https://project.supabase.co"),
  );
  assert.ok(
    headers["Content-Security-Policy"].includes("frame-ancestors 'none'"),
  );
  assert.equal(
    headers["Cross-Origin-Opener-Policy"],
    "same-origin-allow-popups",
  );
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});
for (const origin of [
  "http://localhost:3000",
  "https://localhost",
  "https://localhost.",
  "https://[::ffff:127.0.0.1]",
  "https://api.example.test/path",
  "https://user:password@api.example.test",
  "https://api.example.test?key=secret",
]) {
  test(`rejects unsafe API origin ${origin}`, () =>
    assert.throws(() => vercelConfiguration(env, origin)));
}
test("requires matching same-origin API build config and enforced CSP", () => {
  assert.throws(() =>
    vercelConfiguration(
      { ...env, VITE_API_URL: "https://api.example.test/api/v1" },
      "https://api.example.test",
    ),
  );
  assert.throws(() =>
    vercelConfiguration(
      { ...env, CSP_REPORT_ONLY: "true" },
      "https://api.example.test",
    ),
  );
});
