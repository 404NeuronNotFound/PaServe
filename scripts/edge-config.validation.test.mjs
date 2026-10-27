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
