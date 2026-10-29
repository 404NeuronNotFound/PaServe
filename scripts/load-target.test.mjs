import { test } from "node:test";
import assert from "node:assert/strict";
import { connectLoadTarget, loadTargetSettings } from "./load-target.mjs";
import { runOrderSearchLoad } from "./order-search-load.mjs";

const env = {
  LOAD_BASE_URL: "http://127.0.0.1:45678/api/v1/",
  LOAD_RUN_ID: "00000000-0000-4000-8000-000000000001",
  LOAD_ENVIRONMENT_TOKEN: "a".repeat(64),
};
const marker = () => ({
  version: 1,
  runId: env.LOAD_RUN_ID,
  apiBaseUrl: env.LOAD_BASE_URL,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  environment: "disposable-development",
  fixturesOnly: true,
  externalServices: "blocked",
});
test("rejects a remote opt-in without probing the remote server", async () => {
  let called = false;
  await assert.rejects(
    connectLoadTarget(
      {
        ...env,
        LOAD_BASE_URL: "https://production.example.com/api/v1/",
        LOAD_ALLOW_REMOTE: "1",
      },
      async () => {
        called = true;
        return Response.json(marker());
      },
    ),
  );
  assert.equal(called, false);
});
for (const target of [
  "https://production.example.com/api/v1/",
  "http://localhost:3000/api/v1/",
  "http://127.0.0.1.evil:1234/api/v1/",
  "http://127.0.0.1/api/v1/",
  "ftp://127.0.0.1:1234/api/v1/",
  "http://secret:password@127.0.0.1:1234/api/v1/",
  "http://127.0.0.1:1234/api/v1/?target=prod",
  "http://127.0.0.1:1234/api/v1/#prod",
  "http://127.0.0.1:1234/",
]) {
  test(`refuses unsafe target ${target.replace("secret:password@", "")}`, () =>
    assert.throws(() =>
      loadTargetSettings({
        ...env,
        LOAD_ALLOW_REMOTE: "1",
        LOAD_BASE_URL: target,
      }),
    ));
}
test("requires an explicit target and run capability", () => {
  assert.throws(() => loadTargetSettings({}));
  assert.throws(() =>
    loadTargetSettings({ ...env, LOAD_ENVIRONMENT_TOKEN: "" }),
  );
  assert.throws(() =>
    loadTargetSettings({ ...env, LOAD_RUN_ID: "production" }),
  );
});
for (const mutation of [
  { environment: "production" },
  { runId: "wrong-run" },
  { apiBaseUrl: "http://127.0.0.1:3333/api/v1/" },
  { fixturesOnly: false },
  { externalServices: "enabled" },
  { expiresAt: new Date(0).toISOString() },
  { expiresAt: "invalid" },
  { expiresAt: new Date(Date.now() + 3600000).toISOString() },
]) {
  test(`rejects attestation mismatch ${Object.keys(mutation)[0]} ${Object.values(mutation)[0]}`, async () => {
    let calls = 0;
    await assert.rejects(
      connectLoadTarget(env, async () => {
        calls++;
        return Response.json({ ...marker(), ...mutation });
      }),
    );
    assert.equal(calls, 1);
  });
}
test("refuses a normal localhost API before credentials, writes or a workload", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response("", { status: 404 });
  };
  try {
    await assert.rejects(
      runOrderSearchLoad({
        ...env,
        LOAD_ACCOUNTS_FILE: "must-never-be-read.json",
      }),
    );
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.endsWith("/__paserve_load_environment"));
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(requests[0].options.method, undefined);
    assert.equal(requests[0].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("pins all workload requests and disables redirects, even when a caller asks to follow them", async () => {
  const calls = [];
  const client = await connectLoadTarget(env, async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? Response.json(marker())
      : Response.json({ ok: true });
  });
  await client.fetch(new URL("menu/test", client.base), { redirect: "follow" });
  assert.equal(calls[1].options.redirect, "error");
  assert.throws(() => client.fetch("http://127.0.0.1:45679/api/v1/auth/login"));
  assert.throws(() =>
    client.fetch("https://production.example.com/api/v1/auth/login"),
  );
  assert.throws(() => client.fetch("/auth/login"));
  const now = Date.now;
  Date.now = () => now() + 120000;
  try {
    assert.throws(() => client.fetch("menu/test"));
  } finally {
    Date.now = now;
  }
  assert.equal(calls.length, 2);
});
test("bounds marker payloads and rejects malformed data", async () => {
  await assert.rejects(
    connectLoadTarget(env, async () => new Response("x".repeat(4097))),
  );
  await assert.rejects(
    connectLoadTarget(env, async () => new Response("not JSON")),
  );
});
