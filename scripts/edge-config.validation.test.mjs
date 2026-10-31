import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEdgeConfig } from "./edge-config.mjs";

const deployment = {
  hostname: "api.example.test",
  prefix: "/var/lib/paserve-edge",
  certificate: "/etc/paserve/fullchain.pem",
  certificateKey: "/etc/paserve/key.pem",
  frontendOrigins: ["https://app.example.test"],
};

test("multiple APIs require a single explicit auth owner and retain no-retry writes", async () => {
  await assert.rejects(
    renderEdgeConfig({
      ...deployment,
      upstreams: ["api-a:3000", "api-b:3000"],
    }),
    /authUpstream/,
  );
  const config = await renderEdgeConfig({
    ...deployment,
    upstreams: ["api-a:3000", "api-b:3000"],
    authUpstream: "api-auth:3000",
  });
  assert.match(config, /least_conn; server api-a:3000; server api-b:3000;/);
  assert.match(config, /upstream paserve_auth_origin \{ server api-auth:3000;/);
  assert.match(
    config,
    /location ~\* \^\/api\/v1\/auth\(\/\|\$\) \{ proxy_pass http:\/\/paserve_auth_origin;/,
  );
  assert.match(config, /proxy_next_upstream off/);
});

test("upstream lists cannot inject directives, grow without bounds or mix legacy options", async () => {
  for (const input of [
    { upstreams: [] },
    { upstreams: "api:3000" },
    { upstreams: ["api:3000", "api:3000"] },
    { upstream: "api:3000", upstreams: ["other:3000"] },
    { upstreams: Array.from({ length: 9 }, (_, i) => `api-${i}:3000`) },
    { upstreams: ["api:3000; include secret;"] },
    { upstreams: ["api:3000"], authUpstream: "https://other:3000/path" },
    { upstreams: ["api:3000"], authUpstream: "user:secret@other:3000" },
  ])
    await assert.rejects(renderEdgeConfig({ ...deployment, ...input }));
});

test("public configuration requires TLS material; plaintext check mode binds only loopback", async () => {
  await assert.rejects(
    renderEdgeConfig({ ...deployment, certificate: undefined }),
    /certificate/,
  );
  await assert.rejects(
    renderEdgeConfig({ ...deployment, localCheck: true }),
    /loopback/,
  );
  const config = await renderEdgeConfig(deployment);
  assert.match(config, /listen 443 default_server ssl/);
  assert.match(config, /ssl_protocols TLSv1.2 TLSv1.3/);
  assert.doesNotMatch(config, /@@[A-Z_]+@@/);
  const local = await renderEdgeConfig({
    localCheck: true,
    hostname: "127.0.0.1",
    port: 18080,
    prefix: "/temporary/test",
  });
  assert.match(local, /listen 127.0.0.1:18080 default_server;/);
  assert.doesNotMatch(local, /ssl_certificate/);
});

test("operator values cannot inject NGINX directives or broaden frontend origins", async () => {
  for (const input of [
    { hostname: "api.example.test; include evil;" },
    { prefix: '/tmp/";x' },
    { upstream: "https://public.example.test:3000/path" },
    { upstream: "user:password@host:3000" },
    { certificateKey: "/tmp/$secret" },
    { port: 0 },
    { port: 70000 },
    { workerUser: "root; include evil;" },
    { workerUser: "root" },
    { hostname: "api..example.test" },
    { frontendOrigins: ["https://*.example.test"] },
    { frontendOrigins: ["https://app.example.test/path"] },
    { frontendOrigins: ["http://app.example.test"] },
    { frontendOrigins: ["https://user:password@app.example.test"] },
  ])
    await assert.rejects(renderEdgeConfig({ ...deployment, ...input }));
});

test("logs do not include credentials, paths, IPs or user-controlled request metadata", async () => {
  const config = await renderEdgeConfig(deployment);
  const log = config.split("\n").find((line) => line.includes("log_format "));
  for (const variable of [
    "$request_uri",
    "$request_body",
    "$request ",
    "$uri",
    "$args",
    "$http_",
    "$remote_addr",
    "$binary_remote_addr",
  ])
    assert.ok(!log.includes(variable), variable);
  assert.match(config, /~\^00 1/);
  assert.match(config, /error_log .* crit/);
});
