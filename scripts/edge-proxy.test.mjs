import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { renderEdgeConfig } from "./edge-config.mjs";

const root = resolve(import.meta.dirname, "..");
const localRoot = join(root, ".local-tools");
const binary =
  process.env.NGINX_BIN ??
  (process.platform === "win32"
    ? join(localRoot, "nginx-1.31.8", "nginx.exe")
    : "nginx");
function command(args, cwd) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolveCommand(output)
        : reject(new Error(`NGINX command failed (${code}): ${output}`)),
    );
  });
}
function send(
  port,
  path,
  { method = "GET", headers = {}, body, chunked = false } = {},
) {
  return new Promise((resolveReply, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Connection: "close",
          ...(body === undefined || chunked
            ? {}
            : { "Content-Length": Buffer.byteLength(body) }),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolveReply({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(5000, () =>
      request.destroy(new Error("Test HTTP timeout")),
    );
    request.on("error", reject);
    if (chunked) {
      request.write(body.subarray(0, Math.floor(body.length / 2)));
      request.end(body.subarray(Math.floor(body.length / 2)));
    } else request.end(body);
  });
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test(
  "real NGINX rejects abusive requests before the disposable upstream",
  { timeout: 45_000 },
  async (t) => {
    if (process.platform === "win32")
      await access(binary).catch(() => {
        throw new Error(
          "NGINX binary missing. Set NGINX_BIN or download the documented official Windows test archive. No tests were skipped.",
        );
      });
    await mkdir(localRoot, { recursive: true });
    const workspaceRoot = await realpath(root);
    const privateRoot = await realpath(localRoot);
    const privateRelative = relative(workspaceRoot, privateRoot);
    if (!privateRelative || privateRelative.startsWith("..") || isAbsolute(privateRelative))
      throw new Error("Refusing a test directory outside this workspace");
    const prefix = await mkdtemp(join(localRoot, "edge-check-"));
    for (const name of ["logs", "body", "proxy", "temp"])
      await mkdir(join(prefix, name));
    const calls = [];
    const pending = [];
    let finishStream;
    const origin = http.createServer((request, response) => {
      const call = {
        method: request.method,
        path: request.url,
        headers: request.headers,
        bytes: 0,
        body: "",
      };
      calls.push(call);
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        call.bytes = body.length;
        call.body = body.toString();
        response.setHeader("Cache-Control", "no-store");
        if (request.url.includes("availability-events")) {
          response.setHeader("Content-Type", "text/event-stream");
          response.write("event: ready\ndata: {}\n\n");
          finishStream = () => response.end("event: heartbeat\ndata: {}\n\n");
          return;
        }
        if (request.url.includes("upstream-429")) {
          response.statusCode = 429;
          response.setHeader("Retry-After", "7");
          response.end('{"code":"APPLICATION_LIMIT"}');
          return;
        }
        if (request.url.includes("upstream-503")) {
          response.statusCode = 503;
          response.end('{"code":"BOT_CHALLENGE_UNAVAILABLE"}');
          return;
        }
        if (request.url.includes("hold=1")) {
          pending.push(() => response.end("{}"));
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end("{}");
      });
    });
    const upstreamPort = await listen(origin);
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise((done) => reservation.close(done));
    const config = join(prefix, "nginx.conf");
    const args = [
      "-p",
      prefix.replace(/\\/gu, "/") + "/",
      "-c",
      config.replace(/\\/gu, "/"),
    ];
    await writeFile(
      config,
      await renderEdgeConfig({
        localCheck: true,
        hostname: "127.0.0.1",
        port,
        upstream: `127.0.0.1:${upstreamPort}`,
        prefix,
        frontendOrigins: ["http://app.example.test"],
      }),
    );
    let master;
    let exited;
    try {
      await command([...args, "-t"], prefix);
      master = spawn(binary, [...args, "-g", "daemon off;"], {
        cwd: prefix,
        windowsHide: true,
        stdio: "ignore",
      });
      exited = once(master, "exit");
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          if ((await send(port, "/api/v1")).status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Wait only for this private test listener. */
        }
        await pause(50);
      }
      assert.ok(
        ready,
        `NGINX did not start: ${await readFile(join(prefix, "logs/error.log"), "utf8")}`,
      );
      await t.test(
        "normal menu reads, CORS preflights and punctuation in query/JSON are preserved",
        async () => {
          for (const path of [
            "/api/v1/menu/cafe",
            "/api/v1/menu/wp-admin",
            "/api/v1/menu/cafe?search=100%25%20off",
            "/API/v1/menu/cafe",
          ])
            assert.equal((await send(port, path)).status, 200);
          assert.equal(
            (
              await send(port, "/api/v1/auth/login", {
                method: "OPTIONS",
                headers: {
                  Origin: "http://app.example.test",
                  "Access-Control-Request-Method": "POST",
                },
              })
            ).status,
            200,
          );
          const body = JSON.stringify({
            notes: "O'Brien: 100% off; select a table <3",
            requestId: "fixture",
          });
          assert.equal(
            (
              await send(port, "/api/v1/menu/cafe/orders", {
                method: "POST",
                headers: {
                  "Content-Type":
                    'application/json; profile="https://example.test/schema"',
                },
                body,
              })
            ).status,
            200,
          );
          assert.equal(calls.at(-1).body, body);
          assert.equal(
            (
              await send(port, "/api/v1/shops/fixture/logo", {
                method: "DELETE",
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "scanner/encoded paths, unknown hosts and unsupported methods never reach upstream",
        async () => {
          const before = calls.length;
          for (const path of [
            "/.env",
            "/.git/config",
            "/api/v1/.env.local",
            "/wp-admin/",
            "/api/v1/vendor/phpunit/eval.php",
            "/api/v1/%2eenv",
            "/api/v1/%252eenv",
          ])
            assert.equal((await send(port, path)).status, 403, path);
          assert.equal(
            (
              await send(port, "/api/v1", {
                headers: { Host: "attacker.example" },
              })
            ).status,
            421,
          );
          assert.equal(
            (await send(port, "/api/v1", { method: "TRACE" })).status,
            405,
          );
          assert.equal((await send(port, "/api/v1/auth/login")).status, 405);
          assert.equal(
            (
              await send(port, "/api/v1/auth/login", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: "not-json",
              })
            ).status,
            415,
          );
          assert.equal(
            (
              await send(port, "/api/v1/shops/fixture/logo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              })
            ).status,
            415,
          );
          assert.equal((await send(port, "/unrelated")).status, 404);
          assert.equal(
            (await send(port, "/api/v1?search=" + "a".repeat(9000))).status,
            414,
          );
          assert.equal(
            (
              await send(port, "/api/v1", {
                headers: { Cookie: "a".repeat(9000) },
              })
            ).status,
            400,
          );
          assert.equal(calls.length, before);
        },
      );
      await t.test(
        "declared and chunked oversized bodies are blocked before upstream",
        async () => {
          const before = calls.length;
          for (const [path, size, type] of [
            ["/api/v1/auth/login", 16 * 1024 + 1, "application/json"],
            ["/api/v1/menu/cafe/orders", 1024 * 1024 + 1, "application/json"],
            [
              "/api/v1/shops/fixture/logo",
              6 * 1024 * 1024 + 1,
              "multipart/form-data; boundary=fixture",
            ],
          ])
            assert.equal(
              (
                await send(port, path, {
                  method: "POST",
                  headers: { "Content-Type": type },
                  body: Buffer.alloc(size, "x"),
                })
              ).status,
              413,
            );
          assert.equal(
            (
              await send(port, "/api/v1/menu/cafe/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: Buffer.alloc(1024 * 1024 + 1, "x"),
                chunked: true,
              })
            ).status,
            413,
          );
          assert.equal(calls.length, before);
        },
      );
      await t.test(
        "a five-MiB image plus multipart overhead passes the edge",
        async () => {
          const body = Buffer.concat([
            Buffer.from(
              '--fixture\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n',
            ),
            Buffer.alloc(5 * 1024 * 1024),
            Buffer.from("\r\n--fixture--\r\n"),
          ]);
          assert.equal(
            (
              await send(port, "/api/v1/shops/fixture/products/fixture/image", {
                method: "POST",
                headers: {
                  "Content-Type": "multipart/form-data; boundary=fixture",
                },
                body,
              })
            ).status,
            200,
          );
          assert.equal(calls.at(-1).bytes, body.length);
        },
      );
      await t.test(
        "forwarding headers are replaced while cookies, auth, query and request body survive",
        async () => {
          const body = JSON.stringify({ requestId: "idempotency-fixture" });
          assert.equal(
            (
              await send(port, "/api/v1/menu/cafe/orders?proof=query-fixture", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer access-fixture",
                  Cookie: "proof=cookie-fixture",
                  "X-Forwarded-For": "203.0.113.99",
                  "X-Forwarded-Proto": "https",
                  Forwarded: "for=203.0.113.99",
                  "CF-Connecting-IP": "203.0.113.99",
                  "X-Request-ID": "attacker-id",
                },
                body,
              })
            ).status,
            200,
          );
          const call = calls.at(-1);
          assert.equal(call.headers["x-forwarded-for"], "127.0.0.1");
          assert.equal(call.headers["x-forwarded-proto"], "http");
          assert.equal(call.headers.forwarded, undefined);
          assert.equal(call.headers["cf-connecting-ip"], undefined);
          assert.match(call.headers["x-request-id"], /^[a-f0-9]{32}$/);
          assert.equal(call.headers.authorization, "Bearer access-fixture");
          assert.equal(call.headers.cookie, "proof=cookie-fixture");
          assert.ok(call.path.includes("proof=query-fixture"));
          assert.equal(call.body, body);
        },
      );
      await t.test(
        "upstream throttling and challenge outage responses are not rewritten",
        async () => {
          const limited = await send(port, "/api/v1/upstream-429");
          assert.equal(limited.status, 429);
          assert.equal(limited.headers["retry-after"], "7");
          assert.equal(JSON.parse(limited.body).code, "APPLICATION_LIMIT");
          const outage = await send(port, "/api/v1/upstream-503");
          assert.equal(outage.status, 503);
          assert.equal(
            JSON.parse(outage.body).code,
            "BOT_CHALLENGE_UNAVAILABLE",
          );
        },
      );
      await t.test(
        "SSE first frame arrives while upstream remains open",
        async () => {
          await new Promise((done, reject) => {
            const request = http.get(
              {
                host: "127.0.0.1",
                port,
                path: "/api/v1/menu/cafe/availability-events",
                headers: { Accept: "text/event-stream" },
              },
              (response) => {
                assert.equal(response.statusCode, 200);
                response.once("data", (data) => {
                  assert.ok(data.toString().includes("event: ready"));
                  finishStream();
                });
                response.on("end", done);
                response.on("error", reject);
              },
            );
            request.setTimeout(3000, () =>
              request.destroy(new Error("SSE buffered or timed out")),
            );
            request.on("error", reject);
          });
        },
      );
      await t.test(
        "authentication concurrency rejects early without blocking menu traffic",
        async () => {
          const requests = Array.from({ length: 4 }, () =>
            send(port, "/api/v1/auth/refresh?hold=1", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }),
          );
          try {
            for (let i = 0; i < 50 && pending.length < 4; i++) await pause(20);
            assert.equal(pending.length, 4);
            const before = calls.length;
            const overflow = await send(port, "/api/v1/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            assert.equal(overflow.status, 429);
            assert.equal(calls.length, before);
            assert.equal(overflow.headers["retry-after"], "60");
            assert.equal((await send(port, "/api/v1/menu/cafe")).status, 200);
          } finally {
            pending.splice(0).forEach((finish) => finish());
            await Promise.all(requests);
          }
        },
      );
      await t.test(
        "login flood is rejected at the edge even with forged client IPs; error CORS is bounded",
        async () => {
          const before = calls.length;
          const replies = await Promise.all(
            Array.from({ length: 35 }, (_value, index) =>
              send(port, "/API/v1/auth//LOGIN/", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Origin: "http://app.example.test",
                  "X-Forwarded-For": `192.0.2.${index + 1}`,
                },
                body: "{}",
              }),
            ),
          );
          const limited = replies.filter((reply) => reply.status === 429);
          assert.ok(limited.length > 0);
          assert.ok(replies.some((reply) => reply.status === 200));
          assert.ok(calls.length - before <= 11);
          assert.equal(
            calls.length - before,
            replies.filter((reply) => reply.status === 200).length,
          );
          for (const reply of limited) {
            assert.equal(
              JSON.parse(reply.body).code,
              "EDGE_RATE_LIMIT_EXCEEDED",
            );
            assert.equal(reply.headers["cache-control"], "no-store");
            assert.equal(
              reply.headers["access-control-allow-origin"],
              "http://app.example.test",
            );
            assert.equal(reply.headers["retry-after"], "60");
          }
          const untrusted = await send(port, "/.env", {
            headers: { Origin: "http://untrusted.example" },
          });
          assert.equal(
            untrusted.headers["access-control-allow-origin"],
            undefined,
          );
          assert.equal((await send(port, "/api/v1/menu/cafe")).status, 200);
        },
      );
    } finally {
      pending.splice(0).forEach((finish) => finish());
      finishStream?.();
      if (master) {
        await command([...args, "-s", "quit"], prefix).catch(() => {});
        const finished = await Promise.race([
          exited.then(() => true),
          pause(5000, false, { ref: false }),
        ]);
        if (!finished) {
          await command([...args, "-s", "stop"], prefix).catch(() => {});
          await Promise.race([exited, pause(2000, undefined, { ref: false })]);
        }
      }
      origin.closeAllConnections();
      await new Promise((done) => origin.close(done));
      // Recursive cleanup is restricted to the verified mkdtemp child of this workspace.
      const actualRoot = await realpath(localRoot);
      const rootRelative = relative(workspaceRoot, actualRoot);
      if (!rootRelative || rootRelative.startsWith("..") || isAbsolute(rootRelative))
        throw new Error("Refusing cleanup outside this workspace");
      const actualPrefix = await realpath(prefix);
      const childPath = relative(actualRoot, actualPrefix);
      if (!childPath || childPath.startsWith("..") || isAbsolute(childPath))
        throw new Error("Refusing unsafe test cleanup");
      await rm(actualPrefix, { recursive: true, force: true });
    }
  },
);
